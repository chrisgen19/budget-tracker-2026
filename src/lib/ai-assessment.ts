import { z } from "zod";
import {
  GEMINI_MODEL,
  GEMINI_TIMEOUT_MS,
  generateContentWithRetry,
  receiptScanConfig,
} from "@/lib/gemini";
import {
  assessmentReportSchema,
  webTipsSchema,
  dailyTipSchema,
} from "@/lib/validations";
import type { AiAssessmentReport, AiDailyTip, AiSource } from "@/types";

/* ------------------------------------------------------------------ */
/*  Input payload (sent by the client from its already-computed data)  */
/* ------------------------------------------------------------------ */

const summarySchema = z.object({
  totalIncome: z.number(),
  totalExpenses: z.number(),
  netCashFlow: z.number(),
  transactionCount: z.number(),
});

const subScoreSchema = z.object({
  score: z.number(),
  label: z.string(),
  trend: z.string(),
});

/** The slice of AnalyticsData the AI needs, sent by the client for the selected period. */
export const assessmentPayloadSchema = z.object({
  currency: z.string().default("PHP"),
  granularity: z.enum(["weekly", "monthly", "yearly"]),
  periodLabel: z.string().default(""),
  previousPeriodLabel: z.string().default(""),
  summary: summarySchema,
  previousSummary: summarySchema,
  healthScore: z.object({
    overallScore: z.number(),
    overallLabel: z.string(),
    overallTrend: z.string(),
    savingsRate: z.number().nullable(),
    subScores: z.object({
      savingsRate: subScoreSchema,
      expenseTrend: subScoreSchema,
      incomeStability: subScoreSchema,
      diversification: subScoreSchema,
      consistency: subScoreSchema,
    }),
  }),
  categoryBreakdown: z.array(z.object({
    name: z.string(),
    type: z.enum(["INCOME", "EXPENSE"]),
    amount: z.number(),
    percentage: z.number(),
    transactionCount: z.number(),
  })).default([]),
  labelBreakdown: z.array(z.object({
    name: z.string(),
    amount: z.number(),
    percentage: z.number(),
  })).default([]),
  statistics: z.object({
    avgDailySpend: z.number().nullable(),
    avgExpenseSize: z.number().nullable(),
    spendingStreak: z.number(),
    activeDays: z.number(),
    totalDaysInPeriod: z.number(),
    totalTransactions: z.number(),
    categoriesUsed: z.number(),
    mostUsedCategory: z.object({ name: z.string(), count: z.number() }).nullable(),
    mostExpensiveCategory: z.object({ name: z.string(), amount: z.number() }).nullable(),
  }),
  topTransactions: z.array(z.object({
    description: z.string(),
    amount: z.number(),
    type: z.enum(["INCOME", "EXPENSE"]),
    categoryName: z.string(),
    dateLabel: z.string(),
  })).default([]),
});

export type AssessmentPayload = z.infer<typeof assessmentPayloadSchema>;

/** Upcoming recurring bills, fetched server-side and merged into the prompt. */
export interface UpcomingBillsContext {
  count: number;
  totalAmount: number;
  bills: Array<{ description: string; categoryName: string; amount: number; dueDate: string; isOverdue: boolean }>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Best-effort region hint from the user's currency (drives localized tips). */
const REGION_BY_CURRENCY: Record<string, string> = {
  PHP: "the Philippines",
  USD: "the United States",
  EUR: "the Eurozone",
  GBP: "the United Kingdom",
  AUD: "Australia",
  CAD: "Canada",
  SGD: "Singapore",
  INR: "India",
  JPY: "Japan",
};
const regionFor = (currency: string): string => REGION_BY_CURRENCY[currency.toUpperCase()] ?? "the user's country";

/** Strip markdown fences / surrounding prose and parse the first JSON object. */
const parseJsonObject = (raw: string | undefined): unknown => {
  if (!raw) return null;
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
};

/** Pull grounding source links out of a Gemini response's grounding metadata. */
interface GroundingChunk { web?: { uri?: string; title?: string } }
const extractSources = (response: { candidates?: Array<{ groundingMetadata?: { groundingChunks?: GroundingChunk[] } }> }): AiSource[] => {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: AiSource[] = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title: chunk.web?.title ?? uri, url: uri });
    }
  }
  return sources.slice(0, 8);
};

/** Compact, numbers-included snapshot the model reasons over. */
const buildDataSnapshot = (p: AssessmentPayload, bills: UpcomingBillsContext): string => {
  const h = p.healthScore;
  const topExpenseCats = p.categoryBreakdown.filter((c) => c.type === "EXPENSE").slice(0, 8);
  const subs = h.subScores;
  return JSON.stringify({
    currency: p.currency,
    period: p.periodLabel,
    previousPeriod: p.previousPeriodLabel,
    granularity: p.granularity,
    totals: {
      income: p.summary.totalIncome,
      expenses: p.summary.totalExpenses,
      net: p.summary.netCashFlow,
      transactions: p.summary.transactionCount,
    },
    previousTotals: {
      income: p.previousSummary.totalIncome,
      expenses: p.previousSummary.totalExpenses,
      net: p.previousSummary.netCashFlow,
    },
    healthScore: {
      overall: h.overallScore,
      label: h.overallLabel,
      trend: h.overallTrend,
      savingsRatePct: h.savingsRate === null ? null : Math.round(h.savingsRate * 100),
      subScores: {
        savingsRate: { score: subs.savingsRate.score, trend: subs.savingsRate.trend },
        expenseTrend: { score: subs.expenseTrend.score, trend: subs.expenseTrend.trend },
        incomeStability: { score: subs.incomeStability.score, trend: subs.incomeStability.trend },
        diversification: { score: subs.diversification.score, trend: subs.diversification.trend },
        consistency: { score: subs.consistency.score, trend: subs.consistency.trend },
      },
    },
    topExpenseCategories: topExpenseCats.map((c) => ({
      name: c.name,
      amount: c.amount,
      pctOfSpend: Math.round(c.percentage),
      count: c.transactionCount,
    })),
    topLabels: p.labelBreakdown.slice(0, 5).map((l) => ({ name: l.name, amount: l.amount, pct: Math.round(l.percentage) })),
    stats: {
      avgDailySpend: p.statistics.avgDailySpend,
      avgExpenseSize: p.statistics.avgExpenseSize,
      spendingStreakDays: p.statistics.spendingStreak,
      activeDays: p.statistics.activeDays,
      daysInPeriod: p.statistics.totalDaysInPeriod,
      categoriesUsed: p.statistics.categoriesUsed,
      mostUsedCategory: p.statistics.mostUsedCategory?.name ?? null,
      mostExpensiveCategory: p.statistics.mostExpensiveCategory?.name ?? null,
    },
    biggestTransactions: p.topTransactions.slice(0, 5).map((t) => ({
      description: t.description,
      amount: t.amount,
      type: t.type,
      category: t.categoryName,
      when: t.dateLabel,
    })),
    upcomingBills: {
      count: bills.count,
      total: bills.totalAmount,
      items: bills.bills.slice(0, 8).map((b) => ({ name: b.description, category: b.categoryName, amount: b.amount, overdue: b.isOverdue })),
    },
  });
};

const PRIVACY_RULE =
  "Express insights using PERCENTAGES and RELATIVE terms (e.g. \"dining is ~18% of spending, up 12% vs last period\"). " +
  "Do NOT write raw currency amounts in any prose text. Only the `estimatedMonthlySaving` field may hold a number.";

/* ------------------------------------------------------------------ */
/*  Generation                                                         */
/* ------------------------------------------------------------------ */

/** Data-driven structured assessment (no web tools). */
const generateAssessmentBody = async (snapshot: string, region: string) => {
  const prompt = `You are a practical, encouraging personal finance coach for someone in ${region}.
Analyze this user's financial data for the period and produce a concise, specific assessment.

DATA (JSON):
${snapshot}

RULES:
- ${PRIVACY_RULE}
- Be specific: reference the user's actual category names and trends from the data.
- Keep each item short and actionable. Avoid generic filler.
- "watchList": 2-4 areas to keep an eye on (rising categories, weak sub-scores), each with a severity of "high" | "medium" | "low".
- "cutBack": 2-4 concrete categories/habits to reduce, each with a reason, a suggestion, and estimatedMonthlySaving (a number in the user's currency, or null if unknown).
- "boostSavings": 2-4 savings strategies tailored to the data.
- "earnIdeas": 2-3 realistic ways to earn more, relevant to ${region}.
- "quickActions": 3-5 short next steps.

Respond with ONLY valid JSON (no markdown), shape:
{"summary": string, "scoreCommentary": string, "watchList": [{"title": string, "detail": string, "severity": "high"|"medium"|"low"}], "cutBack": [{"title": string, "reason": string, "suggestion": string, "estimatedMonthlySaving": number|null}], "boostSavings": [{"title": string, "detail": string}], "earnIdeas": [{"title": string, "detail": string}], "quickActions": [string]}`;

  const response = await generateContentWithRetry({
    model: GEMINI_MODEL,
    contents: prompt,
    config: receiptScanConfig(),
  });
  const parsed = assessmentReportSchema.safeParse(parseJsonObject(response.text));
  if (!parsed.success) {
    console.error("[ai-assessment] report parse failed:", parsed.error.issues.map((i) => i.path.join(".")).join(", ") || "non-object response");
    throw new Error("Failed to parse AI assessment response");
  }
  const r = parsed.data;
  const isEmpty =
    !r.summary && !r.scoreCommentary &&
    r.watchList.length === 0 && r.cutBack.length === 0 &&
    r.boostSavings.length === 0 && r.earnIdeas.length === 0 && r.quickActions.length === 0;
  if (isEmpty) throw new Error("AI returned an empty assessment");
  return r;
};

/** Grounded web tips + sources (Google Search). Degrades to empty on failure. */
const generateWebTips = async (snapshot: string, region: string): Promise<{ webTips: AiAssessmentReport["webTips"]; sources: AiSource[] }> => {
  const prompt = `You are a personal finance researcher for someone in ${region}. Using current, reputable web sources, find practical tips to help this user SAVE more and EARN more, tailored to ${region} and their situation.

USER SITUATION (JSON):
${snapshot}

RULES:
- Localize to ${region} (e.g. local high-yield/digital banks, local side-hustles, region-specific programs).
- Make tips actionable and current; prefer reputable finance/savings sources and well-known community guidance.
- Do NOT include raw currency amounts in prose.
- Return 4-6 tips.

Respond with ONLY valid JSON (no markdown): {"webTips": [{"title": string, "detail": string}]}`;

  try {
    const response = await generateContentWithRetry({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        ...(GEMINI_TIMEOUT_MS > 0 && { httpOptions: { timeout: GEMINI_TIMEOUT_MS } }),
      },
    });
    const parsed = webTipsSchema.safeParse(parseJsonObject(response.text));
    return {
      webTips: parsed.success ? parsed.data.webTips : [],
      sources: extractSources(response),
    };
  } catch {
    return { webTips: [], sources: [] };
  }
};

/** Generate the full assessment report (parallel data + grounded calls). */
export const generateAssessment = async (
  payload: AssessmentPayload,
  bills: UpcomingBillsContext
): Promise<{ report: AiAssessmentReport; sources: AiSource[]; model: string }> => {
  const snapshot = buildDataSnapshot(payload, bills);
  const region = regionFor(payload.currency);

  const [body, web] = await Promise.all([
    generateAssessmentBody(snapshot, region),
    generateWebTips(snapshot, region),
  ]);

  const report: AiAssessmentReport = {
    ...body,
    webTips: web.webTips,
    sources: web.sources,
  };
  return { report, sources: web.sources, model: GEMINI_MODEL };
};

/** Minimal, server-buildable context for the daily tip (current-month oriented). */
export interface DailyTipInput {
  currency: string;
  monthLabel: string;
  income: number;
  expenses: number;
  net: number;
  topCategories: Array<{ name: string; amount: number; pct: number }>;
  upcomingBills: UpcomingBillsContext;
}

/** Generate a lightweight daily tip (no grounding — personalized to current-month data). */
export const generateDailyTip = async (
  input: DailyTipInput
): Promise<{ tip: AiDailyTip; model: string }> => {
  const region = regionFor(input.currency);
  const snapshot = JSON.stringify({
    currency: input.currency,
    month: input.monthLabel,
    income: input.income,
    expenses: input.expenses,
    net: input.net,
    topCategories: input.topCategories.slice(0, 6),
    upcomingBills: {
      count: input.upcomingBills.count,
      total: input.upcomingBills.totalAmount,
      items: input.upcomingBills.bills.slice(0, 6).map((b) => ({ name: b.description, amount: b.amount, overdue: b.isOverdue })),
    },
  });
  const prompt = `You are a friendly money coach for someone in ${region}. From this user's current-month data, give ONE short, specific money tip for today (saving or earning).

DATA (JSON):
${snapshot}

RULES:
- ${PRIVACY_RULE}
- One tip only; reference something concrete from their data.
- Keep it under 2 sentences.

Respond with ONLY valid JSON (no markdown): {"tip": string, "rationale": string}`;

  const response = await generateContentWithRetry({
    model: GEMINI_MODEL,
    contents: prompt,
    config: receiptScanConfig(),
  });
  const parsed = dailyTipSchema.safeParse(parseJsonObject(response.text));
  if (!parsed.success) throw new Error("Failed to parse AI daily tip response");
  return { tip: parsed.data, model: GEMINI_MODEL };
};
