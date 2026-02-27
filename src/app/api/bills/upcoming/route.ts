import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const bills = await prisma.scheduledTransaction.findMany({
    where: {
      userId,
      isActive: true,
      nextDueDate: { lte: nextWeek },
    },
    include: { category: true },
    orderBy: { nextDueDate: "asc" },
  });

  const upcomingBills = bills.map((bill) => {
    const dueDate = new Date(bill.nextDueDate);
    dueDate.setHours(0, 0, 0, 0);
    const isOverdue = dueDate < today;

    return {
      id: bill.id,
      description: bill.description || bill.category.name,
      categoryName: bill.category.name,
      categoryIcon: bill.category.icon,
      categoryColor: bill.category.color,
      amount: bill.amount,
      dueDate: bill.nextDueDate.toISOString(),
      isOverdue,
    };
  });

  const totalAmount = upcomingBills.reduce((sum, b) => sum + b.amount, 0);

  return NextResponse.json({
    count: upcomingBills.length,
    totalAmount,
    bills: upcomingBills,
  });
}
