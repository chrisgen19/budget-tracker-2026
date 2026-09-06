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
import type { AiAssessmentReport, AiDailyTip, AiSource, AssessmentFacts } from "@/types";

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

/* Bounds on the client-supplied payload so a crafted request can't blow up the
 * prompt size / token cost. The snapshot only uses the top handful anyway. */
const NAME = z.string().max(120);
const LABEL = z.string().max(60);

/** The slice of AnalyticsData the AI needs, sent by the client for the selected period. */
export const assessmentPayloadSchema = z.object({
  currency: z.string().max(10).default("PHP"),
  granularity: z.enum(["weekly", "monthly", "yearly"]),
  periodLabel: z.string().max(120).default(""),
  previousPeriodLabel: z.string().max(120).default(""),
  summary: summarySchema,
  previousSummary: summarySchema,
  healthScore: z.object({
    overallScore: z.number(),
    overallLabel: LABEL,
    overallTrend: LABEL,
    savingsRate: z.number().nullable(),
    subScores: z.object({
      savingsRate: subScoreSchema,
      expenseTrend: subScoreSchema,
      incomeStability: subScoreSchema,
      diversification: subScoreSchema,
      consistency: subScoreSchema,
    }),
  }),
  // All-types only — the Reports type filter must not skew the assessment, and the
  // cache key is type-independent, so type-filtered fields (labels, top transactions)
  // are intentionally excluded. The statistics block below carries the all-types highlights.
  categoryBreakdown: z.array(z.object({
    name: NAME,
    type: z.enum(["INCOME", "EXPENSE"]),
    amount: z.number(),
    percentage: z.number(),
    transactionCount: z.number(),
  })).max(100).default([]),
  statistics: z.object({
    avgDailySpend: z.number().nullable(),
    avgExpenseSize: z.number().nullable(),
    spendingStreak: z.number(),
    activeDays: z.number(),
    totalDaysInPeriod: z.number(),
    totalTransactions: z.number(),
    categoriesUsed: z.number(),
    mostUsedCategory: z.object({ name: NAME, count: z.number() }).nullable(),
    mostExpensiveCategory: z.object({ name: NAME, amount: z.number() }).nullable(),
  }),
});

export type AssessmentPayload = z.infer<typeof assessmentPayloadSchema>;

/** Upcoming recurring bills, fetched server-side and merged into the prompt. */
export interface UpcomingBillsContext {
  count: number;
  totalAmount: number;
  /** True when any bill's amount was derived from history rather than asserted. */
  totalIsEstimate: boolean;
  bills: Array<{
    description: string;
    categoryName: string;
    amount: number;
    /** A metered bill's figure is derived from past payments, not a sum owed. */
    isEstimate: boolean;
    dueDate: string;
    isOverdue: boolean;
  }>;
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
    // Only trust http(s) links — the URI comes from the model; block javascript:/data: etc.
    if (uri && /^https?:\/\//i.test(uri) && !seen.has(uri)) {
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
    upcomingBills: {
      count: bills.count,
      total: bills.totalAmount,
      // A metered bill's amount is derived from its own history, not owed. The
      // flag travels with it so the model qualifies the figure instead of
      // asserting it -- a report that says "you owe 5,990" of a bill nobody has
      // issued yet is confidently wrong in the one place it must not be.
      totalIsEstimate: bills.totalIsEstimate,
      items: bills.bills.slice(0, 8).map((b) => ({
        name: b.description,
        category: b.categoryName,
        amount: b.amount,
        isEstimate: b.isEstimate,
        overdue: b.isOverdue,
      })),
    },
  });
};


/* ------------------------------------------------------------------ */
/*  Facts digest                                                       */
/* ------------------------------------------------------------------ */

/**
 * The computed findings, trimmed to what the model can actually use.
 *
 * Sent alongside the period aggregates because those alone cannot support a
 * specific claim: five totals let a model say "watch your dining", not "August
 * is missing eleven days of logging, so the fall in spending is a gap, not
 * thrift". Everything here is arithmetic the server already did, so the model's
 * job is to explain it -- never to derive it, and never to add a finding the
 * facts do not contain.
 *
 * Trimmed hard: the full facts payload runs to hundreds of rows, and a prompt
 * that carries all of them costs tokens on every generation to say the same
 * thing. The UI renders the untrimmed version beside the prose.
 */
const buildFactsDigest = (f: AssessmentFacts): string =>
  JSON.stringify({
    dataConfidence: {
      monthsAnalyzed: f.window.months,
      coverageByMonth: f.confidence.months.map((m) => ({ month: m.month, coveragePct: m.coveragePct, status: m.status })),
      trustworthyMonths: f.confidence.trustworthyMonths,
      // Months whose figures were withheld from every rate and trend below.
      excludedForLowCoverage: f.confidence.excludedMonths,
      periodCoveragePct: f.confidence.periodCoveragePct,
      periodIsPartial: f.confidence.periodIsPartial,
      periodDaysElapsed: f.confidence.periodDaysElapsed,
      periodDaysTotal: f.confidence.periodDaysTotal,
      loggingGapsInPeriod: f.confidence.gaps.filter((g) => g.inPeriod).map((g) => ({ from: g.from, to: g.to, days: g.days })),
    },
    anomalies: f.anomalies.map((a) => ({
      kind: a.kind, severity: a.severity, title: a.title, detail: a.detail, changePct: a.changePct,
    })),
    bills: {
      asOf: f.bills.asOf,
      missed: f.bills.missed.map((b) => ({
        bill: b.description, occurrencesMissed: b.missedDueDates.length,
        oldestDueDate: b.missedDueDates[0], daysOverdue: b.daysOverdue, amountIsEstimate: b.isEstimate,
      })),
      // `seasonal` means a metered bill whose budget is right for part of the
      // year, not a misconfigured one. Never tell the user to "fix" that figure.
      misbudgeted: f.bills.accuracy
        .filter((b) => b.verdict !== "ok" && b.verdict !== "no-payments")
        .slice(0, 6)
        .map((b) => ({
          bill: b.description, verdict: b.verdict, variancePct: b.variancePct, swing: b.swing, payments: b.payments,
          // The seasonal shape is the finding for a metered bill: "which months
          // run high" is the only useful answer where no constant is right.
          costByMonth: b.monthlySeries.map((m) => `${m.label} ${Math.round(m.amount)}`),
        })),
      // Counted across the user's WHOLE history, not this period -- the finding is
      // that the schedule stalled, which does not expire. Never describe these as
      // having happened "this period".
      paidOutsideTheBillEverSinceItWasCreated: f.bills.unlinkedPayments.map((u) => ({ bill: u.billDescription, count: u.count })),
      dueInNext14Days: { count: f.bills.dueSoonCount, totalIsEstimate: f.bills.dueSoonIsEstimate },
    },
    trends: {
      comparedMonth: f.trends.comparedMonth,
      baselineMonths: f.trends.baselineMonths,
      baselineSavingsRatePct: f.trends.baselineSavingsRatePct,
      movements: f.trends.movements.slice(0, 8).map((m) => ({
        category: m.category, direction: m.direction, changePct: m.changePct, baselineMonths: m.baselineMonths,
      })),
      netByMonth: f.trends.monthlyNet.map((m) => ({ month: m.month, netIsPositive: m.net >= 0 })),
    },
    recurring: {
      shareOfMonthlySpendPct: f.recurring.monthlyBasePct,
      newChargesLast120Days: f.recurring.newItems.map((i) => ({ item: i.description, months: i.months, firstSeen: i.firstSeen })),
      established: f.recurring.items.filter((i) => !i.isNew).slice(0, 6).map((i) => ({ item: i.description, months: i.months })),
    },
    dataQuality: {
      possibleDuplicates: f.hygiene.duplicates.length,
      duplicatesInPeriod: f.hygiene.duplicates.filter((d) => d.inPeriod).length,
      // A bill payment bypasses label auto-apply: that is the app's behaviour,
      // not the user's sloppiness, and the two must not be reported as one.
      unlabeledFromBills: f.hygiene.unlabeled.fromBills.count,
      unlabeledManual: f.hygiene.unlabeled.manual.count,
      unlabeledPctOfSpend: f.hygiene.unlabeled.pctOfSpend,
      sameThingSpelledSeveralWays: f.hygiene.fragmentation.map((x) => x.variants),
      incomeConcentrationPct: f.hygiene.incomeConcentrationPct,
    },
  });

const PRIVACY_RULE =
  "Express insights using PERCENTAGES and RELATIVE terms (e.g. \"dining is ~18% of spending, up 12% vs last period\"). " +
  "Do NOT write raw currency amounts in any prose text. Only the `estimatedMonthlySaving` field may hold a number.";

/* ------------------------------------------------------------------ */
/*  Generation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Data-driven structured assessment (no web tools).
 *
 * The model is given two things: the period's aggregates, and the findings the
 * server computed from the database. It is told to explain the second rather
 * than to look for patterns of its own, because a model asked to spot trends in
 * a handful of totals will produce something that reads like analysis and is
 * not. The writing rules below come from the `finance-assess` skill (#215),
 * which learned them against real data -- the coverage gate especially, since
 * calling a month with missing rows a frugal one is the mistake that discredits
 * everything else in the report.
 */
const generateAssessmentBody = async (snapshot: string, facts: string, region: string) => {
  const prompt = `You are a practical, encouraging personal finance coach for someone in ${region}.
Analyse this user's finances and write a specific, honest assessment.

PERIOD DATA (JSON):
${snapshot}

COMPUTED FINDINGS (JSON) -- these were calculated from the user's database. They are FACTS:
${facts}

HOW TO READ THE FINDINGS:
- \`dataConfidence\`: months listed in \`excludedForLowCoverage\` have missing rows, NOT low spending.
  Never describe a fall in an excluded or partial month as thrift or improvement. A period marked
  \`periodIsPartial\` is incomplete by definition -- it is never a trend.
- \`bills.missed\`: due dates that passed with no payment, skip or snooze recorded. Say plainly
  which bills and how far behind. It may be an unlogged payment rather than an unpaid bill; give
  both readings rather than accusing.
- \`bills.misbudgeted\`: verdict \`seasonal\` means a metered bill -- electricity, water -- whose
  budgeted figure is genuinely right for part of the year. Do NOT tell the user to correct it, and
  do not report it as "X% over budget"; say which months run high instead. \`under-budgeted\` and
  \`over-budgeted\` are real misconfigurations and should be named as such.
  This binds the summary too: never count a seasonal bill among the bills that need their
  figure fixed, and never total it with one that does. Writing "two bills need adjusting"
  when one of them is metered is the same error as saying it outright.
- \`bills.paidOutsideTheBillEverSinceItWasCreated\`: paid without going through the bill, so the schedule
  never advanced. These counts span the bill's whole life, NOT the assessed period -- never write
  that they happened "this period" or "this month".
- \`dataQuality.unlabeledFromBills\`: bill payments bypass label auto-apply. That is the app's
  behaviour, not the user's carelessness -- attribute it honestly and never lecture about it.
- A bill marked isEstimate (or a total marked totalIsEstimate) is derived from past payments, not a
  sum owed. Qualify it ("about", "roughly") and never present it as an amount due.

RULES:
- ${PRIVACY_RULE}
- Lead with the single most consequential finding, not with the headline totals. If a bill has been
  missed for two months, that goes first and the savings rate waits.
- Separate accuracy problems from money problems. Most findings above are about the numbers being
  wrong; saying so is more useful than inventing frugality advice.
- Give credit where the figures earn it. A healthy savings rate with every month net-positive is a
  good result -- say so plainly and move on to what needs attention.
- Every claim must trace to a figure in the data above. Do not invent a category, a bill or a trend.
  If the findings are thin, write less rather than filling space.
- Be specific: use the user's real category, bill and merchant names.

SECTIONS:
- "summary": 2-3 sentences, leading with the most consequential finding.
- "scoreCommentary": what the health score and its sub-scores actually mean here.
- "outlook": 1-2 sentences on the next few weeks, given bills due and the current run rate.
- "patterns": 2-4 things that went wrong or unusually in this period, each traced to an anomaly or
  bill finding above, with a severity of "high" | "medium" | "low".
- "trends": 2-4 categories heading somewhere, each with a direction of "up" | "down" | "new" | "stable".
  Only use the trustworthy months as the baseline.
- "dataQuality": 1-3 accuracy problems (logging gaps, duplicates, unlinked bill payments, unlabeled
  spend, inconsistent descriptions), each with a concrete "fix". Empty array if the data is clean.
- "watchList": 2-4 areas to keep an eye on, each with a severity.
- "cutBack": 2-4 concrete categories/habits to reduce, each with a reason, a suggestion, and
  estimatedMonthlySaving (a number in the user's currency, or null if unknown).
- "boostSavings": 2-4 savings strategies tailored to the data.
- "earnIdeas": 2-3 realistic ways to earn more, relevant to ${region}.
- "quickActions": 3-5 short next steps, the first being the highest-leverage thing to do this week.

Respond with ONLY valid JSON (no markdown), shape:
{"summary": string, "scoreCommentary": string, "outlook": string, "patterns": [{"title": string, "detail": string, "severity": "high"|"medium"|"low"}], "trends": [{"title": string, "detail": string, "direction": "up"|"down"|"new"|"stable"}], "dataQuality": [{"title": string, "detail": string, "fix": string}], "watchList": [{"title": string, "detail": string, "severity": "high"|"medium"|"low"}], "cutBack": [{"title": string, "reason": string, "suggestion": string, "estimatedMonthlySaving": number|null}], "boostSavings": [{"title": string, "detail": string}], "earnIdeas": [{"title": string, "detail": string}], "quickActions": [string]}`;

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
    !r.summary && !r.scoreCommentary && !r.outlook &&
    r.patterns.length === 0 && r.trends.length === 0 && r.dataQuality.length === 0 &&
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

/**
 * Generate the full assessment report (parallel data + grounded calls).
 *
 * `facts` carries the server-computed findings. It is optional so a caller with
 * no database handle still produces the report it used to; the web-tips call is
 * deliberately *not* given them, since its job is to search the web for advice
 * relevant to the user's situation, and the extra rows only dilute the query.
 */
export const generateAssessment = async (
  payload: AssessmentPayload,
  bills: UpcomingBillsContext,
  facts?: AssessmentFacts
): Promise<{ report: AiAssessmentReport; sources: AiSource[]; model: string }> => {
  const snapshot = buildDataSnapshot(payload, bills);
  const factsDigest = facts ? buildFactsDigest(facts) : "{}";
  const region = regionFor(payload.currency);

  const [body, web] = await Promise.all([
    generateAssessmentBody(snapshot, factsDigest, region),
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
      totalIsEstimate: input.upcomingBills.totalIsEstimate,
      items: input.upcomingBills.bills.slice(0, 6).map((b) => ({
        name: b.description,
        amount: b.amount,
        isEstimate: b.isEstimate,
        overdue: b.isOverdue,
      })),
    },
  });
  const prompt = `You are a friendly money coach for someone in ${region}. From this user's current-month data, give ONE short, specific money tip for today (saving or earning).
A bill marked isEstimate is a metered one whose figure was derived from past payments, not a sum owed: say "about" of it, never state it as a bill to pay.

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
