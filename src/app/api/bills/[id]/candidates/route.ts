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
 * Narrowed by the bill's own **category**, not merely its type. Type and a
 * fortnight's window sound restrictive and are not: for this account they leave
 * 145 candidates for one Meralco occurrence, so the payment being looked for
 * would sit among two dozen unrelated expenses and invite attaching the wrong
 * row -- worse than the skip it corrects. The same window within the bill's
 * category leaves 2. A miscategorised payment is therefore not offered, which
 * is the deliberate trade: a short list that can be read beats a long one that
 * cannot, and the empty state says what was searched.
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
    select: { id: true, userId: true, type: true, categoryId: true, category: { select: { name: true } } },
  });
  if (!bill || bill.userId !== userId) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  // A due date is a date-only value stored at midnight UTC, so the window is
  // built in UTC too rather than resolved through anybody's timezone.
  const due = utcDayStart(new Date(`${parsed.data}T00:00:00.000Z`));

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      type: bill.type,
      categoryId: bill.categoryId,
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
    take: 25,
  });

  // Nearest the due date first: a bill paid a day late is a likelier match than
  // one paid a fortnight early, and the list is short enough to sort in memory.
  const candidates = rows.sort(
    (a, b) =>
      Math.abs(a.date.getTime() - due.getTime()) - Math.abs(b.date.getTime() - due.getTime()),
  );

  return NextResponse.json({
    candidates,
    windowDays: WINDOW_DAYS,
    categoryName: bill.category.name,
  });
}
