import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { labelRowAllowsCategory } from "@/lib/label-category-matching";
import { transactionSchema } from "@/lib/validations";
import { categoriesAreUsable } from "@/lib/transaction-writes";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const transactionIdSchema = z.string().trim().min(1).max(100);

export async function GET(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { id: rawId } = await params;
    const id = transactionIdSchema.parse(rawId);
    const transaction = await prisma.transaction.findFirst({
      where: { id, userId },
      include: { category: true, bill: true, labels: { include: { label: true } } },
    });

    if (!transaction) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    return NextResponse.json(transaction);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid transaction ID" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to load transaction" }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    // Verify ownership. The labels come along because both branches below need them: the
    // reconciliation branch to preserve them, and the moved-check to decide whether this edit
    // changed anything at all. Reading them here rather than in the branch replaces a query
    // rather than adding one.
    const existing = await prisma.transaction.findFirst({
      where: { id, userId },
      include: { labels: { include: { label: { select: { applicableTo: true } } } } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const body = await request.json();
    const validated = transactionSchema.parse(body);

    // Validate the category the same way the create path does. The foreign key only requires the
    // row to exist -- not that it is this user's, and not that its type matches -- so without this
    // an EXPENSE could be filed under an INCOME category, or another user's category attached and
    // then rendered back by the `include` below (#229). `transactionSchema` requires both fields on
    // every PUT, so `validated` is the effective row and needs no merge with `existing`.
    //
    // Only when the pair actually *moves*, matching `updateTransactions`, which documents why at
    // length: `PUT /api/categories/[id]` lets a custom category's `type` be flipped while its
    // transactions keep pointing at it, leaving rows whose stored pair no longer agrees. This
    // route is a full replace, so the browser re-sends that pair on every edit -- judging it would
    // reject a correction to the amount or the description, locking the row out over a state the
    // edit did not create and does not worsen. Writing back what is already stored introduces
    // nothing, and every genuine reclassification still moves one of the two fields.
    const reclassifies =
      validated.categoryId !== existing.categoryId || validated.type !== existing.type;
    if (reclassifies && !(await categoriesAreUsable(prisma, userId, [validated]))) {
      return NextResponse.json(
        { error: "The category is invalid, does not belong to you, or does not match the transaction type" },
        { status: 400 }
      );
    }

    // Validate label ownership before writing (only when labelIds is explicitly provided)
    const hasLabelIds = validated.labelIds !== undefined;
    const verifiedLabelIds: string[] = [];

    if (hasLabelIds && validated.labelIds!.length > 0) {
      const ownedLabels = await prisma.label.findMany({
        where: { id: { in: validated.labelIds! }, userId },
        select: {
          id: true,
          name: true,
          applicableTo: true,
          categories: { select: { categoryId: true } },
        },
      });
      if (ownedLabels.length !== validated.labelIds!.length) {
        return NextResponse.json(
          { error: "One or more labels are invalid or do not belong to you" },
          { status: 400 }
        );
      }
      // Only keep labels compatible with the transaction type
      const compatible = ownedLabels.filter(
        (l) => l.applicableTo === "BOTH" || l.applicableTo === validated.type
      );

      // Refused, as on the create path -- but only for labels this save is *adding*. A label
      // already on the row passes whatever its restriction now says, the same grandfather clause
      // `updateTransactions` applies: narrowing a label's categories is an edit to the label, and
      // it must not make every older transaction carrying it unsaveable, down to fixing a typo in
      // its description. The form posts the whole object on every save, so without this an
      // unrelated edit to such a row would be refused.
      const alreadyOnRow = new Set(existing.labels.map((el) => el.labelId));
      const outOfCategory = compatible.filter(
        (l) => !alreadyOnRow.has(l.id) && !labelRowAllowsCategory(l, validated.categoryId)
      );
      if (outOfCategory.length > 0) {
        const names = outOfCategory.map((l) => l.name).join(", ");
        return NextResponse.json(
          { error: `${names} cannot be used on a transaction in this category.` },
          { status: 400 }
        );
      }

      verifiedLabelIds.push(...compatible.map((l) => l.id));
    }

    // Server-side label reconciliation when labelIds not provided (cold-cache edits, hidden-label flows).
    // Always runs to enforce type compatibility, even for users without schedules.
    if (!hasLabelIds) {
      // Preserve existing labels, only dropping those incompatible with the
      // (possibly changed) transaction type. We never re-apply scheduled labels
      // on edit — preserving as-is respects prior user overrides.
      for (const el of existing.labels) {
        if (el.label.applicableTo !== "BOTH" && el.label.applicableTo !== validated.type) continue;
        verifiedLabelIds.push(el.labelId);
      }
    }

    const scalars = {
      amount: validated.amount,
      description: validated.description,
      type: validated.type,
      date: new Date(validated.date),
      categoryId: validated.categoryId,
    };

    // Whether this save actually changes the row, compared against what is stored rather than
    // against which keys the request carried. The distinction is the whole point here: the form
    // posts all five fields on every save, so "the request named it" is true of every field on
    // every edit and would report a change on a save that made none.
    const scalarsMoved =
      scalars.amount !== existing.amount ||
      scalars.description !== existing.description ||
      scalars.type !== existing.type ||
      scalars.date.getTime() !== existing.date.getTime() ||
      scalars.categoryId !== existing.categoryId;

    const labelIdsBefore = existing.labels.map((l) => l.labelId).sort();
    const labelsMoved = [...verifiedLabelIds].sort().join(" ") !== labelIdsBefore.join(" ");

    const moved = scalarsMoved || labelsMoved;

    const result = await prisma.$transaction(async (tx) => {
      // Only a save that moves something writes anything. An unchanged save must leave the row
      // exactly as it is: opening the edit modal and pressing Update with no edits would
      // otherwise rewrite `updated_via` to APP and null the token id, erasing a genuine MCP trail
      // for an edit that never happened -- and `updatedAt` carries `@updatedAt`, so Prisma would
      // bump that too and the row would go on looking freshly edited.
      //
      // `updatedByMcpTokenId` is cleared rather than left alone. This column names the row's
      // *last* editor, so a row corrected over MCP and then fixed here has to stop naming the
      // token: a stale id is not a gap in the trail, it is a confidently wrong answer (#232).
      if (moved) {
        await tx.transaction.update({
          where: { id },
          data: { ...scalars, updatedVia: "APP", updatedByMcpTokenId: null },
        });
      }

      // Replaced wholesale rather than diffed, as before -- `transaction_labels` holds nothing
      // but the pairing -- but only when the set actually differs. The delete-then-recreate used
      // to run on every save, churning link rows to land on the same set.
      if (labelsMoved) {
        await tx.transactionLabel.deleteMany({ where: { transactionId: id } });

        if (verifiedLabelIds.length > 0) {
          await tx.transactionLabel.createMany({
            data: verifiedLabelIds.map((labelId) => ({
              transactionId: id,
              labelId,
            })),
          });
        }
      }

      return tx.transaction.findUniqueOrThrow({
        where: { id },
        include: { category: true, bill: true, labels: { include: { label: true } } },
      });
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const existing = await prisma.transaction.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  await prisma.transaction.delete({ where: { id } });

  return NextResponse.json({ message: "Transaction deleted" });
}
