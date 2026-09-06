"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { stagger, fadeUp } from "@/components/analytics/motion-variants";
import { useAssessmentQuery, useAssessmentFactsQuery, useDailyTipQuery } from "@/hooks/use-assessment";
import { useAssessment, periodKeyOf } from "@/components/assessment-provider";
import { AssessmentNarrative } from "@/components/analytics/assessment/narrative";
import { AssessmentFactsPanel } from "@/components/analytics/assessment/facts-panel";
import type { AnalyticsData, AiAssessmentReport as Report } from "@/types";
import type { AssessmentPayload } from "@/lib/ai-assessment";

interface AiAssessmentReportProps {
  data: AnalyticsData;
  period: { granularity: string; from: string; to: string };
  currency: string;
  hideAmounts: boolean;
}

const relativeTime = (iso: string): string => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

/** Masks currency amounts (e.g. "₱1,200", "PHP 500", "$50.25") in AI prose so a
 *  non-compliant model response can't leak figures when Hide Amounts is on.
 *  Leaves percentages and bare counts intact. */
const CURRENCY_IN_PROSE = /(?:[₱$€£¥]|\b(?:PHP|USD|EUR|GBP|AUD|CAD|SGD|INR|JPY))\s?\d[\d,]*(?:\.\d+)?/gi;
const maskProse = (text: string, hide: boolean): string =>
  hide ? text.replace(CURRENCY_IN_PROSE, "•••") : text;

/** Build the AI payload from the already-computed analytics data. */
const buildPayload = (data: AnalyticsData, currency: string, granularity: string): AssessmentPayload => {
  const sub = data.healthScore.subScores;
  const pick = (s: { score: number; label: string; trend: string }) => ({ score: s.score, label: s.label, trend: s.trend });
  return {
    currency,
    granularity: granularity as AssessmentPayload["granularity"],
    periodLabel: data.periodLabel,
    previousPeriodLabel: data.previousPeriodLabel,
    summary: data.summary,
    previousSummary: data.previousSummary,
    healthScore: {
      overallScore: data.healthScore.overallScore,
      overallLabel: data.healthScore.overallLabel,
      overallTrend: data.healthScore.overallTrend,
      savingsRate: data.healthScore.savingsRate,
      subScores: {
        savingsRate: pick(sub.savingsRate),
        expenseTrend: pick(sub.expenseTrend),
        incomeStability: pick(sub.incomeStability),
        diversification: pick(sub.diversification),
        consistency: pick(sub.consistency),
      },
    },
    categoryBreakdown: data.allCategoryBreakdown.map((c) => ({
      name: c.name, type: c.type, amount: c.amount, percentage: c.percentage, transactionCount: c.transactionCount,
    })),
    statistics: {
      avgDailySpend: data.statistics.avgDailySpend,
      avgExpenseSize: data.statistics.avgExpenseSize,
      spendingStreak: data.statistics.spendingStreak,
      activeDays: data.statistics.activeDays,
      totalDaysInPeriod: data.statistics.totalDaysInPeriod,
      totalTransactions: data.statistics.totalTransactions,
      categoriesUsed: data.statistics.categoriesUsed,
      mostUsedCategory: data.statistics.mostUsedCategory
        ? { name: data.statistics.mostUsedCategory.name, count: data.statistics.mostUsedCategory.count }
        : null,
      mostExpensiveCategory: data.statistics.mostExpensiveCategory
        ? { name: data.statistics.mostExpensiveCategory.name, amount: data.statistics.mostExpensiveCategory.amount }
        : null,
    },
  };
};

/** Apply the prose mask to every free-text field a model wrote. */
const maskReport = (report: Report): Report => {
  const m = (s: string) => maskProse(s, true);
  return {
    ...report,
    summary: m(report.summary),
    scoreCommentary: m(report.scoreCommentary),
    outlook: m(report.outlook),
    patterns: report.patterns.map((p) => ({ ...p, title: m(p.title), detail: m(p.detail) })),
    trends: report.trends.map((t) => ({ ...t, title: m(t.title), detail: m(t.detail) })),
    dataQuality: report.dataQuality.map((d) => ({ ...d, title: m(d.title), detail: m(d.detail), fix: m(d.fix) })),
    watchList: report.watchList.map((w) => ({ ...w, title: m(w.title), detail: m(w.detail) })),
    cutBack: report.cutBack.map((c) => ({ ...c, title: m(c.title), reason: m(c.reason), suggestion: m(c.suggestion) })),
    boostSavings: report.boostSavings.map((t) => ({ ...t, title: m(t.title), detail: m(t.detail) })),
    earnIdeas: report.earnIdeas.map((t) => ({ ...t, title: m(t.title), detail: m(t.detail) })),
    quickActions: report.quickActions.map(m),
    webTips: report.webTips.map((t) => ({ ...t, title: m(t.title), detail: m(t.detail) })),
  };
};

function DailyTipCard({ hideAmounts }: { hideAmounts: boolean }) {
  const { data, isLoading } = useDailyTipQuery();
  if (isLoading) {
    return <div className="card p-4 sm:p-5 animate-pulse h-20 bg-cream-50/60" />;
  }
  if (!data?.tip) return null;
  return (
    <motion.div variants={fadeUp} className="card p-4 sm:p-5 bg-amber-light/40 border-amber/20">
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles className="w-4 h-4 text-amber-dark" />
        <h3 className="text-[11px] font-medium tracking-wider text-amber-dark uppercase">Today&apos;s Tip</h3>
      </div>
      <p className="text-sm font-medium text-warm-700">{maskProse(data.tip.tip, hideAmounts)}</p>
      <p className="text-xs text-warm-400 mt-1">{maskProse(data.tip.rationale, hideAmounts)}</p>
    </motion.div>
  );
}

/**
 * The AI Assessment tab: a written assessment over a measured one.
 *
 * The measured half (`AssessmentFactsPanel`) is computed server-side and shown
 * whether or not a report has been generated — finding out that a bill has gone
 * unpaid should not cost an AI generation. The written half interprets exactly
 * those figures, so every claim in it can be checked against the row below.
 */
export function AiAssessmentReport({ data, period, currency, hideAmounts }: AiAssessmentReportProps) {
  const { data: reportData, isLoading, isError: reportError } = useAssessmentQuery(period);
  const facts = useAssessmentFactsQuery(period);
  const { isGenerating, generate } = useAssessment();

  const payload = useMemo(() => buildPayload(data, currency, period.granularity), [data, currency, period.granularity]);
  const fmt = (n: number | null) => (n === null ? "—" : hideAmounts ? "•••" : formatCurrency(n, currency));

  const rawReport = reportData?.report;
  // Mask any currency figures the model may have written into prose when Hide Amounts is on.
  const report = useMemo(
    () => (!rawReport || !hideAmounts ? rawReport : maskReport(rawReport)),
    [rawReport, hideAmounts]
  );
  const hasData = data.summary.transactionCount > 0;
  // A period with nothing logged is exactly when an unpaid bill matters most, so
  // the measured half is gated on the window having anything to say — not on this
  // period having rows.
  const factsData = facts.data?.facts;
  const showFacts =
    hasData ||
    (factsData !== undefined &&
      (factsData.bills.missed.length > 0 || factsData.confidence.months.some((m) => m.transactionCount > 0)));
  const pending = isGenerating(periodKeyOf(period.granularity, period.from, period.to));

  const handleGenerate = () =>
    generate({ from: period.from, to: period.to, granularity: period.granularity, payload });

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <DailyTipCard hideAmounts={hideAmounts} />

      {/* Header + generate/refresh */}
      <motion.div variants={fadeUp} className="card p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber" />
              <h2 className="font-serif text-lg text-warm-700">AI Assessment</h2>
            </div>
            <p className="text-xs text-warm-400 mt-1">
              {report
                ? `For ${data.periodLabel}${reportData?.generatedAt ? ` · updated ${relativeTime(reportData.generatedAt)}` : ""}`
                : `Personalized insights for ${data.periodLabel}`}
            </p>
          </div>
          {hasData && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={pending}
              className="inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium text-sm px-4 py-2 rounded-xl transition-colors shadow-soft disabled:opacity-60 shrink-0"
            >
              {pending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : report ? (
                <RefreshCw className="w-4 h-4" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {pending ? "Analyzing…" : report ? "Refresh" : "Generate"}
            </button>
          )}
        </div>

        {pending && (
          <p className="text-xs text-warm-400 mt-3">
            Analyzing in the background — feel free to browse; we&apos;ll notify you when it&apos;s ready.
          </p>
        )}

        {reportError && !pending && (
          <p className="text-xs text-expense mt-3">Couldn&apos;t load your saved assessment. Tap Generate to try again.</p>
        )}

        {!hasData && (
          <p className="text-sm text-warm-400 mt-3">Add some transactions for this period to get an AI assessment.</p>
        )}

        {hasData && !report && !pending && !isLoading && (
          <p className="text-sm text-warm-500 mt-3">
            The findings below are measured from your data and always up to date. Tap{" "}
            <span className="font-medium">Generate</span> to have AI read them and suggest where to cut back, how to save
            more, and ways to earn.
          </p>
        )}
      </motion.div>

      {report && <AssessmentNarrative report={report} fmt={fmt} />}

      {(showFacts || facts.isLoading) && (
        <>
          <motion.div variants={fadeUp} className="flex items-center gap-3 pt-2">
            <span className="h-px flex-1 bg-cream-200" />
            <span className="text-[10px] font-medium tracking-wider text-warm-300 uppercase">The numbers behind it</span>
            <span className="h-px flex-1 bg-cream-200" />
          </motion.div>
          <AssessmentFactsPanel
            facts={factsData}
            isLoading={facts.isLoading}
            isError={facts.isError}
            currency={currency}
            hideAmounts={hideAmounts}
          />
        </>
      )}

      {report && (
        <p className="text-[11px] text-warm-300 text-center px-4">
          AI-generated guidance based on your data — not professional financial advice.
        </p>
      )}
    </motion.div>
  );
}
