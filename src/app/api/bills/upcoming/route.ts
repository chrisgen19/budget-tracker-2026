import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { utcDayStart } from "@/lib/bill-utils";
import { estimateBillAmount, type EstimateSample } from "@/lib/bill-estimate";

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const tz = parseInt(searchParams.get("tz") || "0");
  const tzMs = tz * 60 * 1000;

  // Compute "today" in the user's local timezone
  const nowUtc = new Date();
  const localNow = new Date(nowUtc.getTime() - tzMs);
  const today = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()));

  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const bills = await prisma.scheduledTransaction.findMany({
    where: {
      userId,
      isActive: true,
      nextDueDate: { lte: nextWeek },
    },
    include: {
      category: true,
      // Payments already linked to the bill, for estimating a variable one.
      // Only variable bills use these, but fetching them here keeps this a
      // single round trip rather than one per bill.
      transactions: { select: { date: true, amount: true } },
    },
    orderBy: { nextDueDate: "asc" },
  });

  const upcomingBills = bills.map((bill) => {
    const dueDate = utcDayStart(bill.nextDueDate);
    const isOverdue = dueDate < today;
    const diffMs = dueDate.getTime() - today.getTime();
    const daysUntilDue = Math.round(diffMs / (1000 * 60 * 60 * 24));

    // A variable bill's stored amount is a fallback, not a claim. Its forecast
    // comes from what it has actually cost -- preferring the same month a year
    // ago, since an annual mean is wrong in both directions every month.
    const estimate = bill.isVariable
      ? estimateBillAmount(
          bill.transactions.map((t): EstimateSample => {
            const local = new Date(t.date.getTime() - tzMs);
            return {
              year: local.getUTCFullYear(),
              month: local.getUTCMonth() + 1,
              amount: t.amount,
              at: t.date.getTime(),
            };
          }),
          dueDate.getUTCMonth() + 1,
          dueDate.getUTCFullYear(),
          bill.amount,
        )
      : null;

    return {
      id: bill.id,
      description: bill.description || bill.category.name,
      categoryName: bill.category.name,
      categoryIcon: bill.category.icon,
      categoryColor: bill.category.color,
      // `amount` stays the figure to plan with, so every existing caller keeps
      // working; `isEstimate` says whether it was asserted or derived. A caller
      // that ignores the flag gets a usable number rather than a zero, which is
      // why a null amount was rejected for variable bills.
      amount: estimate ? estimate.amount : bill.amount,
      isEstimate: estimate !== null,
      estimateBasis: estimate?.basis ?? null,
      estimateSampleSize: estimate?.sampleSize ?? null,
      dueDate: bill.nextDueDate.toISOString(),
      isOverdue,
      daysUntilDue,
    };
  });

  const totalAmount = upcomingBills.reduce((sum, b) => sum + b.amount, 0);
  // True when any component of the total was derived rather than asserted, so
  // the widget can show "~" instead of implying a figure it cannot know.
  const totalIsEstimate = upcomingBills.some((b) => b.isEstimate);

  return NextResponse.json({
    count: upcomingBills.length,
    totalAmount,
    totalIsEstimate,
    bills: upcomingBills,
  });
}
