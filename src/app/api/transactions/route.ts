import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { transactionSchema } from "@/lib/validations";

export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const month = searchParams.get("month"); // format: YYYY-MM
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const categoryId = searchParams.get("categoryId");
  const amountMin = searchParams.get("amountMin");
  const amountMax = searchParams.get("amountMax");
  const sortBy = searchParams.get("sortBy") || "date"; // "date" | "amount"
  const sortDir = searchParams.get("sortDir") || "desc"; // "asc" | "desc"
  const search = searchParams.get("search");

  const where: Record<string, unknown> = { userId };

  if (type === "INCOME" || type === "EXPENSE") {
    where.type = type;
  }

  if (month) {
    const [year, m] = month.split("-").map(Number);
    where.date = {
      gte: new Date(year, m - 1, 1),
      lt: new Date(year, m, 1),
    };
  }

  if (categoryId) {
    where.categoryId = categoryId;
  }

  // Amount range filter
  if (amountMin || amountMax) {
    const amountFilter: Record<string, number> = {};
    if (amountMin) amountFilter.gte = parseFloat(amountMin);
    if (amountMax) amountFilter.lte = parseFloat(amountMax);
    where.amount = amountFilter;
  }

  // Server-side search (case-insensitive on description)
  if (search) {
    where.description = { contains: search, mode: "insensitive" };
  }

  // Dynamic sort
  const direction = sortDir === "asc" ? "asc" : "desc";
  const orderBy =
    sortBy === "amount"
      ? [{ amount: direction as "asc" | "desc" }, { date: "desc" as const }]
      : [{ date: direction as "asc" | "desc" }, { createdAt: "desc" as const }];

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { category: true },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return NextResponse.json({
    transactions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const validated = transactionSchema.parse(body);

    const transaction = await prisma.transaction.create({
      data: {
        amount: validated.amount,
        description: validated.description,
        type: validated.type,
        date: new Date(validated.date),
        categoryId: validated.categoryId,
        userId,
      },
      include: { category: true },
    });

    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}
