import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";

interface RouteParams {
  params: Promise<{ id: string; labelId: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id, labelId } = await params;

  // Verify transaction ownership
  const transaction = await prisma.transaction.findFirst({
    where: { id, userId },
    select: { id: true },
  });

  if (!transaction) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  // One transaction, because the stamp is not repairable on a retry. If the update failed after
  // an independently committed delete, the link would be gone while the row went on naming its
  // previous MCP editor -- and the retry the 500 invites finds no link left to delete, returns
  // the 404 below and never reaches the stamp again, so the wrong provenance is permanent.
  const removed = await prisma.$transaction(async (tx) => {
    const deleted = await tx.transactionLabel.deleteMany({
      where: { transactionId: id, labelId },
    });

    if (deleted.count === 0) return false;

    // Removing a label is an edit of this transaction, so it stamps the audit columns exactly as
    // `PUT /api/transactions/[id]`, the bulk `PATCH` and the retroactive apply do (#232). Written
    // only when a link was really deleted, so a no-op cannot rewrite a genuine MCP trail with an
    // APP one.
    await tx.transaction.updateMany({
      where: { id, userId },
      data: { updatedVia: "APP", updatedByMcpTokenId: null },
    });
    return true;
  });

  if (!removed) {
    return NextResponse.json({ error: "Label not found on transaction" }, { status: 404 });
  }

  return NextResponse.json({ message: "Label removed" });
}
