import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { labelSchema } from "@/lib/validations";
import { categoriesUsableForLabel, LABEL_INCLUDE } from "@/lib/label-writes";
import { categoryRestrictionNarrowed } from "@/lib/label-category-matching";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const existing = await prisma.label.findFirst({
      where: { id, userId },
      include: { categories: { select: { categoryId: true } } },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Label not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validated = labelSchema.parse(body);
    // If the client didn't send applicableTo, preserve the existing value
    // (prevents older cached clients from silently widening the scope to BOTH)
    if (!("applicableTo" in body)) {
      validated.applicableTo = existing.applicableTo as "EXPENSE" | "INCOME" | "BOTH";
    }
    // Same reasoning for the category restriction: an absent field means "not sent" and must
    // preserve what is stored, because an empty list here means *every* category. A client that
    // predates this feature omits it, and treating that as "unrestrict this label" would quietly
    // undo the narrowing on the first save from a stale tab.
    if (!("categoryIds" in body)) {
      validated.categoryIds = existing.categories.map((c) => c.categoryId);
    }
    const confirmRemoval = body.confirmRemoval === true;

    const categoryCheck = await categoriesUsableForLabel(
      prisma,
      userId,
      validated.categoryIds ?? [],
      validated.applicableTo,
    );
    if (!categoryCheck.ok) {
      return NextResponse.json({ error: categoryCheck.message }, { status: 400 });
    }

    // Check for duplicate name (excluding self)
    const duplicate = await prisma.label.findFirst({
      where: { name: { equals: validated.name, mode: "insensitive" }, userId, NOT: { id } },
    });

    if (duplicate) {
      return NextResponse.json(
        { error: "A label with this name already exists" },
        { status: 400 }
      );
    }

    // Check if type restriction is being narrowed (e.g. BOTH → EXPENSE)
    // If so, count affected transactions and require confirmation
    const oldApplicableTo = existing.applicableTo;
    const newApplicableTo = validated.applicableTo;
    let removedType: string | null = null;

    if (oldApplicableTo !== newApplicableTo) {
      if (oldApplicableTo === "BOTH" && newApplicableTo === "EXPENSE") removedType = "INCOME";
      else if (oldApplicableTo === "BOTH" && newApplicableTo === "INCOME") removedType = "EXPENSE";
      else if (oldApplicableTo === "INCOME" && newApplicableTo === "EXPENSE") removedType = "INCOME";
      else if (oldApplicableTo === "EXPENSE" && newApplicableTo === "INCOME") removedType = "EXPENSE";
    }

    // Narrowing the category restriction strips associations exactly the way narrowing the type
    // does, so it goes through the same confirm-before-removing flow rather than a second one.
    //
    // Only a *change* counts. A save that leaves the set alone must not offer to strip rows that
    // were already outside it: those are grandfathered everywhere else (the picker keeps showing
    // them, the write paths keep accepting them), and a confirmation prompt on an unrelated
    // rename would be the one place that disagreed.
    //
    // An empty new set means every category, which removes nothing by definition.
    const oldCategoryIds = existing.categories.map((c) => c.categoryId).sort();
    const newCategoryIds = [...(validated.categoryIds ?? [])].sort();
    // Narrowed means the new set *removes* something the old one allowed, never merely that it
    // differs -- see `categoryRestrictionNarrowed`, which owns that rule beside the predicate it
    // mirrors. Comparing the two for inequality counted a pure widening as a narrowing.
    const categoriesNarrowed = categoryRestrictionNarrowed(oldCategoryIds, newCategoryIds);

    // One predicate for both narrowings, so a save that does both asks once and strips once.
    const excluded: Prisma.TransactionWhereInput[] = [
      ...(removedType ? [{ type: removedType as "INCOME" | "EXPENSE" }] : []),
      ...(categoriesNarrowed ? [{ categoryId: { notIn: newCategoryIds } }] : []),
    ];

    if (excluded.length > 0) {
      const affectedCount = await prisma.transactionLabel.count({
        where: { labelId: id, transaction: { OR: excluded } },
      });

      if (affectedCount > 0 && !confirmRemoval) {
        return NextResponse.json(
          {
            needsConfirmation: true,
            affectedCount,
            removedType,
            categoriesNarrowed,
          },
          { status: 409 }
        );
      }
    }

    const label = await prisma.$transaction(async (tx) => {
      // Remove associations the narrowed type or category set no longer allows, once confirmed
      if (excluded.length > 0 && confirmRemoval) {
        await tx.transactionLabel.deleteMany({
          where: { labelId: id, transaction: { OR: excluded } },
        });
      }

      // Sync schedules: delete all existing, re-create from input
      if (validated.schedules !== undefined) {
        await tx.labelSchedule.deleteMany({ where: { labelId: id } });

        if (validated.schedules.length > 0) {
          await tx.labelSchedule.createMany({
            data: validated.schedules.map((s) => ({
              labelId: id,
              days: s.days,
              startTime: s.startTime,
              endTime: s.endTime,
            })),
          });
        }
      }

      // Sync categories the same way: delete all existing, re-create from input. The set is
      // small and unordered, so reconciling it row by row would buy nothing.
      if (validated.categoryIds !== undefined) {
        await tx.labelCategory.deleteMany({ where: { labelId: id } });

        if (validated.categoryIds.length > 0) {
          await tx.labelCategory.createMany({
            data: validated.categoryIds.map((categoryId) => ({ labelId: id, categoryId })),
          });
        }
      }

      return tx.label.update({
        where: { id },
        data: {
          name: validated.name,
          color: validated.color,
          applicableTo: validated.applicableTo,
        },
        include: LABEL_INCLUDE,
      });
    });

    return NextResponse.json(label);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update label" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const existing = await prisma.label.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Label not found" },
      { status: 404 }
    );
  }

  await prisma.label.delete({ where: { id } });

  return NextResponse.json({ message: "Label deleted" });
}
