import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { addUtcDays, utcDayStart } from "@/lib/bill-dates";

/** How far from the due date a payment may sit and still be offered. */
const WINDOW_DAYS = 14;

/**
 * Payments that could settle one occurrence of this bill.
 *
 * Exists so a wrongly skipped occurrence can be corrected in the app. Skip is
 * what people press when the bill is already paid and they want the reminder
 * gone, and until #216 nothing could undo that -- the API refused, and the UI
 * offered no way to attach the payment that was already sitting in the ledger.
 *
 * Deliberately narrow: only the user's own transactions, only the bill's own
 * type, only rows carrying no `billId` yet, and only within a fortnight of the
 * due date. A wider net would list a page of unrelated spending and invite
 * attaching the wrong one, which is worse than the skip it corrects.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const parsed = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD")
    .safeParse(new URL(request.url).searchParams.get("dueDate"));

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const bill = await prisma.scheduledTransaction.findUnique({
    where: { id },
    select: { id: true, userId: true, type: true },
  });
  if (!bill || bill.userId !== userId) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  // A due date is a date-only value stored at midnight UTC, so the window is
  // built in UTC too rather than resolved through anybody's timezone.
  const due = utcDayStart(new Date(`${parsed.data}T00:00:00.000Z`));

  const candidates = await prisma.transaction.findMany({
    where: {
      userId,
      type: bill.type,
      billId: null,
      date: { gte: addUtcDays(due, -WINDOW_DAYS), lte: addUtcDays(due, WINDOW_DAYS) },
    },
    select: {
      id: true,
      date: true,
      amount: true,
      description: true,
      category: { select: { name: true, icon: true, color: true } },
    },
    orderBy: { date: "asc" },
    take: 25,
  });

  return NextResponse.json({ candidates, windowDays: WINDOW_DAYS });
}
