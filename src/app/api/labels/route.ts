import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { labelSchema } from "@/lib/validations";
import { createLabel } from "@/lib/label-writes";

export async function GET() {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const labels = await prisma.label.findMany({
    where: { userId },
    include: {
      _count: { select: { transactions: true } },
      schedules: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { name: "asc" },
  });

  // Per-category usage, for ranking the picker's quick chips. `categoryId` lives on the
  // transaction rather than the join row, so this cannot be a Prisma `groupBy` on
  // `transactionLabel` -- that can only group by its own columns.
  //
  // Ranking data, never a restriction: a pair missing here means the label has not been used in
  // that category yet, so it sorts last rather than disappearing. That distinction is the whole
  // reason this is a count and not a filter (#304).
  const usage = await prisma.$queryRaw<{ labelId: string; categoryId: string; n: number }[]>`
    SELECT tl.label_id AS "labelId", t.category_id AS "categoryId", COUNT(*)::int AS n
    FROM transaction_labels tl
    JOIN transactions t ON t.id = tl.transaction_id
    WHERE t.user_id = ${userId}
    GROUP BY tl.label_id, t.category_id
  `;

  const countsByLabel = new Map<string, Record<string, number>>();
  for (const row of usage) {
    const existing = countsByLabel.get(row.labelId) ?? {};
    existing[row.categoryId] = row.n;
    countsByLabel.set(row.labelId, existing);
  }

  return NextResponse.json(
    labels.map((label) => ({ ...label, categoryCounts: countsByLabel.get(label.id) ?? {} })),
  );
}

export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  try {
    const body = await request.json();
    const validated = labelSchema.parse(body);

    // Shared with the MCP `create_label` tool, so the case-insensitive duplicate rule cannot
    // diverge between the two.
    const result = await createLabel({
      prisma,
      userId,
      name: validated.name,
      color: validated.color,
      applicableTo: validated.applicableTo,
      schedules: validated.schedules,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "A label with this name already exists" },
        { status: 400 }
      );
    }

    return NextResponse.json(result.label, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create label" }, { status: 500 });
  }
}
