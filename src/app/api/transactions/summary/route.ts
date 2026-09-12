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
      // Echoed rather than left for the caller to remember. The aggregate runs over
      // a WHERE that already applied the type, so an expense summary always reports
      // `income: 0` — a figure that means "excluded", not "none". Read under the
      // wrong type it is not stale, it is wrong, so the answer carries the question.
      // `filters.type` is the *effective* type after parsing, which is what the
      // numbers describe even when the caller sent something the schema defaulted.
      type: filters.type,
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
