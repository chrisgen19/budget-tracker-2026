"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Scissors,
  PiggyBank,
  Lightbulb,
  CheckCircle2,
  Globe,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { stagger, fadeUp } from "@/components/analytics/motion-variants";
import { useAssessmentQuery, useDailyTipQuery } from "@/hooks/use-assessment";
import { useAssessment, periodKeyOf } from "@/components/assessment-provider";
import type { AnalyticsData, AiWatchSeverity } from "@/types";
import type { AssessmentPayload } from "@/lib/ai-assessment";

interface AiAssessmentReportProps {
  data: AnalyticsData;
  period: { granularity: string; from: string; to: string };
  currency: string;
  hideAmounts: boolean;
}

const SEVERITY_STYLES: Record<AiWatchSeverity, { dot: string; label: string; text: string }> = {
  high: { dot: "bg-expense", label: "High", text: "text-expense" },
  medium: { dot: "bg-amber", label: "Medium", text: "text-amber-dark" },
  low: { dot: "bg-warm-400", label: "Low", text: "text-warm-400" },
};

const relativeTime = (iso: string): string => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

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

function Section({ icon: Icon, title, children }: { icon: typeof Sparkles; title: string; children: React.ReactNode }) {
  return (
    <motion.div variants={fadeUp} className="card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-amber" />
        <h3 className="font-serif text-lg text-warm-700">{title}</h3>
      </div>
      {children}
    </motion.div>
  );
}

function DailyTipCard() {
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
      <p className="text-sm font-medium text-warm-700">{data.tip.tip}</p>
      <p className="text-xs text-warm-400 mt-1">{data.tip.rationale}</p>
    </motion.div>
  );
}

export function AiAssessmentReport({ data, period, currency, hideAmounts }: AiAssessmentReportProps) {
  const { data: reportData, isLoading, isError: reportError } = useAssessmentQuery(period);
  const { isGenerating, generate } = useAssessment();

  const payload = useMemo(() => buildPayload(data, currency, period.granularity), [data, currency, period.granularity]);
  const fmt = (n: number | null) => (n === null ? "—" : hideAmounts ? "•••" : formatCurrency(n, currency));

  const report = reportData?.report;
  const hasData = data.summary.transactionCount > 0;
  const pending = isGenerating(periodKeyOf(period.granularity, period.from, period.to));

  const handleGenerate = () =>
    generate({ from: period.from, to: period.to, granularity: period.granularity, payload });

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      <DailyTipCard />

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
            Tap <span className="font-medium">Generate</span> to have AI analyze your spending and suggest where to cut back, how to save more, and ways to earn.
          </p>
        )}
      </motion.div>

      {report && (
        <>
          {/* Summary + score commentary */}
          <Section icon={Sparkles} title="Summary">
            <p className="text-sm text-warm-600 leading-relaxed">{report.summary}</p>
            <p className="text-sm text-warm-500 leading-relaxed mt-3">{report.scoreCommentary}</p>
          </Section>

          {report.watchList.length > 0 && (
            <Section icon={AlertTriangle} title="Watch list">
              <ul className="space-y-3">
                {report.watchList.map((item, i) => {
                  const sev = SEVERITY_STYLES[item.severity];
                  return (
                    <li key={i} className="flex gap-3">
                      <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", sev.dot)} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-warm-700">
                          {item.title} <span className={cn("text-[10px] uppercase tracking-wider", sev.text)}>· {sev.label}</span>
                        </p>
                        <p className="text-sm text-warm-500">{item.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {report.cutBack.length > 0 && (
            <Section icon={Scissors} title="Cut back">
              <ul className="space-y-3">
                {report.cutBack.map((item, i) => (
                  <li key={i} className="p-3 rounded-xl bg-cream-50/60">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-warm-700 truncate">{item.title}</p>
                      {item.estimatedMonthlySaving !== null && (
                        <span className="text-xs font-medium text-income shrink-0">save ~{fmt(item.estimatedMonthlySaving)}/mo</span>
                      )}
                    </div>
                    <p className="text-sm text-warm-500 mt-1">{item.reason}</p>
                    <p className="text-sm text-warm-600 mt-1">💡 {item.suggestion}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {report.boostSavings.length > 0 && (
            <Section icon={PiggyBank} title="Boost savings">
              <TipList items={report.boostSavings} />
            </Section>
          )}

          {report.earnIdeas.length > 0 && (
            <Section icon={Lightbulb} title="Ways to earn">
              <TipList items={report.earnIdeas} />
            </Section>
          )}

          {report.quickActions.length > 0 && (
            <Section icon={CheckCircle2} title="Quick actions">
              <ul className="space-y-2">
                {report.quickActions.map((action, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-warm-600">
                    <CheckCircle2 className="w-4 h-4 text-income shrink-0 mt-0.5" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {report.webTips.length > 0 && (
            <Section icon={Globe} title="Tips from the web">
              <TipList items={report.webTips} />
              {report.sources.length > 0 && (
                <div className="mt-4 pt-3 border-t border-cream-200/70">
                  <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase mb-2">Sources</p>
                  <ul className="space-y-1.5">
                    {report.sources.map((s, i) => (
                      <li key={i}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-amber-dark hover:underline"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate">{s.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}

          <p className="text-[11px] text-warm-300 text-center px-4">
            AI-generated guidance based on your data — not professional financial advice.
          </p>
        </>
      )}
    </motion.div>
  );
}

function TipList({ items }: { items: Array<{ title: string; detail: string }> }) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i}>
          <p className="text-sm font-medium text-warm-700">{item.title}</p>
          <p className="text-sm text-warm-500">{item.detail}</p>
        </li>
      ))}
    </ul>
  );
}
