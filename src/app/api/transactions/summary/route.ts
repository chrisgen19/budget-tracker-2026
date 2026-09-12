import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import {
  buildTransactionWhere,
  parseTransactionSearchParams,
} from "@/lib/transaction-filter-query";

/**
 * `amount` is a Float, so a sum accumulates representation error — adding 28 rows
 * can land on 45230.000000001. The client renders this as currency, so round here
 * rather than leaving every consumer to remember.
 */
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Totals for the rows the current filters match, across the whole window rather
 * than the loaded page.
 *
 * Deliberately its own route rather than a field on `GET /api/transactions`: in
 * infinite mode the list is fetched page by page, and a total riding along would
 * re-run this aggregate on every scroll even though it cannot change between
 * pages. Keyed on the filters alone, it runs once per filter change.
 */
export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const { searchParams } = new URL(request.url);
    const filters = parseTransactionSearchParams(searchParams);
    const where = buildTransactionWhere(userId, filters);

    const grouped = await prisma.transaction.groupBy({
      by: ["type"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });

    const sumOf = (type: "INCOME" | "EXPENSE") =>
      round2(grouped.find((row) => row.type === type)?._sum.amount ?? 0);

    const income = sumOf("INCOME");
    const expense = sumOf("EXPENSE");

    return NextResponse.json({
      count: grouped.reduce((total, row) => total + row._count._all, 0),
      income,
      expense,
      net: round2(income - expense),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid transaction filters" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to load transaction summary" }, { status: 500 });
  }
}
