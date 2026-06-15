import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import type { AiAssessmentReport, AiAssessmentResponse } from "@/types";

/** GET /api/assessment?granularity&from&to — returns the cached report for the period (or null). */
export async function GET(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  const { searchParams } = new URL(request.url);
  const granularity = searchParams.get("granularity");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!granularity || !from || !to) {
    return NextResponse.json({ error: "Missing period params" }, { status: 400 });
  }

  const periodKey = `${granularity}:${from}:${to}`;
  const row = await prisma.aiAssessment.findUnique({
    where: { userId_kind_periodKey: { userId, kind: "REPORT", periodKey } },
  });

  const body: AiAssessmentResponse = row
    ? {
        report: row.content as unknown as AiAssessmentReport,
        generatedAt: row.generatedAt.toISOString(),
        model: row.model,
      }
    : { report: null, generatedAt: null, model: null };

  return NextResponse.json(body);
}
