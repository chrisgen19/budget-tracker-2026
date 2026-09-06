import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { collectAssessmentFacts } from "@/lib/assessment-facts-query";
import { formatPeriodLabel, type PeriodType } from "@/lib/analytics-period";
import type { AssessmentFactsResponse } from "@/types";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const querySchema = z.object({
  granularity: z.enum(["weekly", "monthly", "yearly", "custom"]),
  from: z.string().regex(DAY),
  to: z.string().regex(DAY),
});

/**
 * GET /api/assessment/facts?granularity&from&to
 *
 * The deterministic half of the assessment: coverage, bill accuracy and missed
 * occurrences, category movement, recurring spend, duplicates and anomalies.
 *
 * Computed live rather than cached beside the AI narrative. These are cheap
 * aggregates over the user's own rows, and a fact that has changed since the
 * report was written should say so rather than agreeing with a stale sentence.
 */
export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    granularity: searchParams.get("granularity"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }
  const { granularity, from, to } = parsed.data;
  if (from > to) {
    return NextResponse.json({ error: "Period starts after it ends" }, { status: 400 });
  }

  try {
    const facts = await collectAssessmentFacts(prisma, userId, {
      from,
      to,
      granularity,
      periodLabel: formatPeriodLabel(granularity as PeriodType, from, to),
    });
    const body: AssessmentFactsResponse = { facts };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[assessment/facts] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to compute assessment facts" }, { status: 500 });
  }
}
