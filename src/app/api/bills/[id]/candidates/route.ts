import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { utcDayStart } from "@/lib/bill-dates";
import { formatLocalDate } from "@/lib/validations";

/** How far from the due date a payment may sit and still be offered. */
const WINDOW_DAYS = 14;
/** Most candidates returned. Short on purpose: this list is read, not paged. */
const LIMIT = 25;

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

  const { timezoneOffset } = (await prisma.user.findUnique({
    where: { id: userId },
    select: { timezoneOffset: true },
  })) ?? { timezoneOffset: 0 };

  const bill = await prisma.scheduledTransaction.findUnique({
    where: { id },
    select: {
      id: true, userId: true, type: true, categoryId: true, amount: true,
      category: { select: { name: true } },
    },
  });
  if (!bill || bill.userId !== userId) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  // The due date is a date-only value stored at midnight UTC and means "the
  // 8th" -- but a transaction's `date` is an *instant*, so the window has to be
  // the user's calendar days, not UTC's. Under UTC+8 a payment made at 00:30 on
  // the boundary day is stored on the previous UTC date and was being dropped,
  // while the empty state claimed no payment existed. One formula app-wide:
  // Date.UTC(y, m, d) + tzOffset * 60000 (AGENTS.md).
  const due = utcDayStart(new Date(`${parsed.data}T00:00:00.000Z`));
  const y = due.getUTCFullYear();
  const mo = due.getUTCMonth();
  const d = due.getUTCDate();
  // Date.UTC normalises day over- and underflow, so ±14 needs no clamping.
  const localDayStart = (offsetDays: number) =>
    new Date(Date.UTC(y, mo, d + offsetDays) + timezoneOffset * 60000);
  const windowStart = localDayStart(-WINDOW_DAYS);
  const dueDayStart = localDayStart(0);
  // Inclusive of the whole last day, or the window silently loses it.
  const windowEnd = new Date(localDayStart(WINDOW_DAYS + 1).getTime() - 1);

  const select = {
    id: true,
    date: true,
    amount: true,
    description: true,
    category: { select: { name: true, icon: true, color: true } },
  };
  const base = { userId, type: bill.type, categoryId: bill.categoryId, billId: null };

  // Taken from both sides of the due date, each ordered outwards from it, so a
  // cap can never drop the closest match. A single query capped at 25 returns an
  // arbitrary 25 of the window -- and ordering it by date alone returns the
  // oldest, so a payment made on the due date itself could be missing while a
  // fortnight-early one is listed.
  const [before, after] = await Promise.all([
    prisma.transaction.findMany({
      where: { ...base, date: { gte: windowStart, lt: dueDayStart } },
      select,
      orderBy: { date: "desc" },
      take: LIMIT,
    }),
    prisma.transaction.findMany({
      where: { ...base, date: { gte: dueDayStart, lte: windowEnd } },
      select,
      orderBy: { date: "asc" },
      take: LIMIT,
    }),
  ]);

  // Nearest the due date first: a bill paid a day late is a likelier match than
  // one paid a fortnight early.
  const candidates = [...before, ...after]
    .sort(
      (a, b) =>
        Math.abs(a.date.getTime() - dueDayStart.getTime()) -
        Math.abs(b.date.getTime() - dueDayStart.getTime()),
    )
    .slice(0, LIMIT)
    // Every read row carries its own calendar day beside the instant, so no
    // client has to derive one. formatBillDate forces UTC -- right for a
    // date-only bill anchor, wrong for a payment instant -- so rendering
    // `date` directly showed a 00:30 UTC+8 payment on the previous day, inside
    // the very dialog meant to stop the wrong row being picked.
    .map((c) => ({ ...c, localDate: formatLocalDate(c.date, timezoneOffset) }));

  return NextResponse.json({
    candidates,
    windowDays: WINDOW_DAYS,
    categoryName: bill.category.name,
    // The bill's own amount, so the panel can show what was expected beside
    // what is offered. A mobile top-up sitting in the same category as a water
    // bill is only obviously wrong once both numbers are on screen.
    expectedAmount: bill.amount,
  });
}
