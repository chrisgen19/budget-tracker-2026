import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { transactionSchema } from "@/lib/validations";
import { updateTransactions, type UpdateFailureReason } from "@/lib/transaction-writes";

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

/**
 * Map an update failure onto the status the app's form expects.
 *
 * `NOT_FOUND` is the only 404: everything else is a request the caller can correct. The
 * category cases are new to this route -- it never checked category ownership or type-match at
 * all, which the shared service now does for both callers -- and they surface as 400 alongside
 * the label check that was always here.
 */
const UPDATE_FAILURE_STATUS: Record<UpdateFailureReason, number> = {
  NOT_FOUND: 404,
  NO_FIELDS: 400,
  DUPLICATE_ID: 400,
  LABELS_NOT_OWNED: 400,
  CATEGORIES_NOT_OWNED: 400,
  NO_LONGER_PERMITTED: 403,
  WRITE_FAILED: 500,
};

const UPDATE_FAILURE_MESSAGE: Record<UpdateFailureReason, string> = {
  NOT_FOUND: "Transaction not found",
  NO_FIELDS: "Invalid input",
  DUPLICATE_ID: "Invalid input",
  LABELS_NOT_OWNED: "One or more labels are invalid or do not belong to you",
  CATEGORIES_NOT_OWNED: "That category is invalid, or does not match the transaction's type",
  NO_LONGER_PERMITTED: "Not permitted",
  WRITE_FAILED: "Failed to update transaction",
};

export async function PUT(request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const body = await request.json();
    const validated = transactionSchema.parse(body);

    // The form already resolves its picker value to an absolute instant client-side, so this is
    // only ever the fallback branch of `resolvePatchDate`. Read rather than assumed anyway: a
    // hardcoded 0 would silently resolve any bare date that ever reached here against UTC.
    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezoneOffset: true },
    });
    if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // The whole edit -- ownership, category usability, label reconciliation, the audit stamp --
    // goes through the same service the MCP `update_transactions` tool uses. It used to be
    // written out here, and the copy was missing the category ownership and type-match checks
    // that the create path has had since a model could reach it.
    const result = await updateTransactions({
      prisma,
      userId,
      patches: [
        {
          id,
          amount: validated.amount,
          description: validated.description,
          type: validated.type,
          date: validated.date,
          // Preserved exactly as before: an explicit list replaces the labels, and omitting the
          // field keeps what is there, dropping only what the (possibly changed) type excludes.
          // Scheduled labels are never re-applied on an edit, which respects prior overrides.
          labelIds: validated.labelIds,
        },
      ],
      timezoneOffset: account.timezoneOffset,
      updatedVia: "APP",
      // Cleared explicitly, not left alone. Without this a row edited over MCP and then corrected
      // here would go on naming the token as its last editor, which is worse than no audit trail:
      // it is a wrong one.
      updatedByMcpTokenId: null,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: UPDATE_FAILURE_MESSAGE[result.reason] },
        { status: UPDATE_FAILURE_STATUS[result.reason] }
      );
    }

    // Re-read with this route's own include. The service returns category and labels; the form's
    // cache entry also carries `bill`, and dropping it here would quietly change the shape the
    // transaction list re-inserts after an edit.
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id },
      include: { category: true, bill: true, labels: { include: { label: true } } },
    });

    return NextResponse.json(transaction);
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
