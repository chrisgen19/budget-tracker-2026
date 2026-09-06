import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { assessmentReportSchema } from "@/lib/validations";
import type { AiAssessmentReport, AiAssessmentResponse } from "@/types";

/**
 * Re-validate a stored report on the way out.
 *
 * Rows cached before a section existed have no key for it, and the schema's
 * defaults fill those in. Without this the client would read `undefined` where
 * it expects an array -- a report written last month must keep rendering, minus
 * the sections it was never asked for.
 */
const normalize = (content: unknown): AiAssessmentReport => {
  const parsed = assessmentReportSchema.safeParse(content);
  const base = parsed.success ? parsed.data : null;
  const stored = content as Partial<AiAssessmentReport> | null;
  return {
    ...(base ?? ({} as AiAssessmentReport)),
    // webTips and sources are added after validation in the generator, so they
    // are not part of the schema and have to be carried across by hand.
    webTips: stored?.webTips ?? [],
    sources: stored?.sources ?? [],
  } as AiAssessmentReport;
};

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
        report: normalize(row.content),
        generatedAt: row.generatedAt.toISOString(),
        model: row.model,
      }
    : { report: null, generatedAt: null, model: null };

  return NextResponse.json(body);
}
