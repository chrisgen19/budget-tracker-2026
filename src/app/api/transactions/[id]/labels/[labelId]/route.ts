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

  const deleted = await prisma.transactionLabel.deleteMany({
    where: { transactionId: id, labelId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "Label not found on transaction" }, { status: 404 });
  }

  // Removing a label is an edit of this transaction, so it stamps the audit columns exactly as
  // `PUT /api/transactions/[id]`, the bulk `PATCH` and the retroactive apply do. Written only
  // after a link was really deleted -- the 404 above returns first -- so a no-op cannot rewrite a
  // genuine MCP trail with an APP one.
  await prisma.transaction.updateMany({
    where: { id, userId },
    data: { updatedVia: "APP", updatedByMcpTokenId: null },
  });

  return NextResponse.json({ message: "Label removed" });
}
