import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { billActionSchema } from "@/lib/validations";
import { settleBill, type BillActionFailureReason } from "@/lib/bill-writes";

/**
 * What each refusal looks like over HTTP.
 *
 * The logic itself lives in `settleBill`, shared with the MCP `pay_bill` tool: locking the bill
 * row, refusing a second terminal log on one occurrence, walking to the earliest unsettled
 * occurrence and switching the bill off when the schedule runs out. This route is the mapping from
 * that result to a status code and nothing more.
 */
const FAILURES: Record<BillActionFailureReason, { status: number; error: string }> = {
  BILL_NOT_FOUND: { status: 404, error: "Bill not found" },
  TRANSACTION_NOT_FOUND: { status: 404, error: "Transaction not found" },
  PAYMENT_ALREADY_LINKED: { status: 409, error: "That payment is already linked to another bill" },
  AMOUNT_REQUIRED: {
    status: 400,
    error:
      "This bill's amount varies, so the payment amount is required. " +
      "Use Pay & Edit to enter what you actually paid.",
  },
  // The app holds no write lease, so `settleBill` is called without one and this is unreachable
  // from here. Listed because the map is total over the reason union: a reason added later has to
  // be answered here rather than falling through to a generic 500.
  NO_LONGER_PERMITTED: { status: 409, error: "Writes are currently switched off for this account" },
  ALREADY_SETTLED: { status: 409, error: "This occurrence has already been paid or skipped" },
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  try {
    const body = await request.json();
    const { action, dueDate, transactionId, snoozeDays, amount } = billActionSchema.parse(body);

    // "Snooze for a day" means a day in the user's calendar, not the server's and not UTC's.
    const { timezoneOffset } = (await prisma.user.findUnique({
      where: { id: userId },
      select: { timezoneOffset: true },
    })) ?? { timezoneOffset: 0 };

    const result = await settleBill({
      prisma,
      userId,
      billId: id,
      action,
      dueDate: new Date(dueDate),
      amount,
      transactionId,
      snoozeDays,
      timezoneOffset: timezoneOffset ?? 0,
    });

    if (!result.ok) {
      const failure = FAILURES[result.reason];
      // `pay_existing` can supersede a skip, so "or skipped" would name a state it did not refuse
      // on.
      const error =
        result.reason === "ALREADY_SETTLED" && action === "pay_existing"
          ? "This occurrence has already been paid"
          : failure.error;
      return NextResponse.json({ error }, { status: failure.status });
    }

    if (action === "pay") {
      return NextResponse.json({ message: "Bill paid", transactionId: result.transactionId });
    }
    if (action === "pay_existing") return NextResponse.json({ message: "Bill marked as paid" });
    if (action === "snooze") {
      const days = snoozeDays ?? 1;
      return NextResponse.json({ message: `Bill snoozed for ${days} day${days > 1 ? "s" : ""}` });
    }
    return NextResponse.json({ message: "Bill skipped" });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to process action" }, { status: 500 });
  }
}
