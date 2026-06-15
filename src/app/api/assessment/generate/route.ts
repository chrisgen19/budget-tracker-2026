import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUserId } from "@/lib/session";
import { isGeminiUnavailable } from "@/lib/gemini";
import { getUpcomingBills } from "@/lib/budget-queries";
import {
  assessmentPayloadSchema,
  generateAssessment,
  type UpcomingBillsContext,
} from "@/lib/ai-assessment";

/** Max AI report generations per user per day (manual generate/refresh). Override with AI_ASSESSMENT_DAILY_LIMIT. */
const parsedLimit = Number.parseInt(process.env.AI_ASSESSMENT_DAILY_LIMIT ?? "", 10);
const DAILY_LIMIT = Number.isNaN(parsedLimit) ? 10 : parsedLimit;

const generateRequestSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  payload: assessmentPayloadSchema,
});

/** POST /api/assessment/generate — generate (or refresh) the report for a period and cache it. */
export async function POST(request: Request) {
  const userId = await getAuthUserId();
  if (userId instanceof NextResponse) return userId;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = generateRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { from, to, payload } = parsed.data;

  // Daily generation cap — anchored to the user's local midnight, not the server's.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezoneOffset: true } });
  const tzOffset = user?.timezoneOffset ?? 0;
  const localNow = new Date(Date.now() - tzOffset * 60_000);
  const startOfDay = new Date(
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) + tzOffset * 60_000
  );
  const usedToday = await prisma.aiUsageLog.count({
    where: { userId, kind: "REPORT", createdAt: { gte: startOfDay } },
  });
  if (usedToday >= DAILY_LIMIT) {
    return NextResponse.json(
      { error: "Daily AI generation limit reached. Please try again tomorrow." },
      { status: 429 }
    );
  }

  const periodKey = `${payload.granularity}:${from}:${to}`;

  // Reserve quota BEFORE the expensive Gemini calls (mirrors the bill-reminders
  // log-then-delete-on-failure pattern). This shrinks the cap race window from the
  // full ~10s generation to the few ms between the count() above and this write,
  // so concurrent requests can't each run two Gemini calls. Rolled back on failure.
  const usageLog = await prisma.aiUsageLog.create({ data: { userId, kind: "REPORT" } });

  try {
    const billsResult = await getUpcomingBills(prisma, userId, { days: 14 });
    const bills: UpcomingBillsContext = {
      count: billsResult.count,
      totalAmount: billsResult.totalAmount,
      bills: billsResult.bills,
    };

    const { report, sources, model } = await generateAssessment(payload, bills);

    const content = report as unknown as Prisma.InputJsonValue;
    const sourcesJson = sources as unknown as Prisma.InputJsonValue;

    const row = await prisma.aiAssessment.upsert({
      where: { userId_kind_periodKey: { userId, kind: "REPORT", periodKey } },
      create: { userId, kind: "REPORT", periodKey, content, sources: sourcesJson, model },
      update: { content, sources: sourcesJson, model, generatedAt: new Date() },
    });

    return NextResponse.json({
      report,
      generatedAt: row.generatedAt.toISOString(),
      model,
    });
  } catch (error) {
    // Generation failed — release the reserved quota so the user isn't charged for it.
    await prisma.aiUsageLog.delete({ where: { id: usageLog.id } }).catch(() => {});

    if (isGeminiUnavailable(error)) {
      return NextResponse.json(
        { error: "The AI service is busy right now. Please try again in a minute." },
        { status: 503 }
      );
    }
    console.error("[assessment/generate] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Failed to generate assessment. Please try again." },
      { status: 500 }
    );
  }
}
