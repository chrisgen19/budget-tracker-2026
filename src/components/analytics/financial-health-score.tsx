"use client";

import {
  PiggyBank,
  TrendingDown,
  TrendingUp,
  Shield,
  PieChart,
  Activity,
  Minus,
  Sparkles,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { stagger, fadeUp } from "@/components/analytics/motion-variants";
import type { AnalyticsHealthScore, HealthSubScore, HealthTrend } from "@/types";

interface FinancialHealthScoreProps {
  healthScore: AnalyticsHealthScore;
}

const SCORE_COLORS: Record<string, { text: string; stroke: string; bg: string }> = {
  Excellent: { text: "text-emerald-600", stroke: "stroke-emerald-500", bg: "bg-emerald-50" },
  Good: { text: "text-green-600", stroke: "stroke-green-500", bg: "bg-green-50" },
  Fair: { text: "text-amber-600", stroke: "stroke-amber-500", bg: "bg-amber-50" },
  "Needs Attention": { text: "text-orange-600", stroke: "stroke-orange-500", bg: "bg-orange-50" },
  Critical: { text: "text-red-600", stroke: "stroke-red-500", bg: "bg-red-50" },
};

/** Fill color for a sub-score progress bar, banded to mirror SCORE_COLORS. */
function scoreBarClass(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-green-500";
  if (score >= 40) return "bg-amber-500";
  if (score >= 20) return "bg-orange-500";
  return "bg-red-500";
}

const TREND_CONFIG: Record<HealthTrend, { icon: typeof TrendingUp; color: string; label: string }> = {
  improving: { icon: TrendingUp, color: "text-green-500", label: "Improving" },
  declining: { icon: TrendingDown, color: "text-red-500", label: "Declining" },
  stable: { icon: Minus, color: "text-amber-500", label: "Stable" },
  new: { icon: Sparkles, color: "text-blue-500", label: "First period" },
};

const SUB_SCORE_ICONS = {
  savingsRate: { icon: PiggyBank, color: "text-emerald-600", bg: "bg-emerald-50" },
  expenseTrend: { icon: TrendingDown, color: "text-blue-600", bg: "bg-blue-50" },
  incomeStability: { icon: Shield, color: "text-purple-600", bg: "bg-purple-50" },
  diversification: { icon: PieChart, color: "text-amber-600", bg: "bg-amber-50" },
  consistency: { icon: Activity, color: "text-warm-600", bg: "bg-cream-100" },
};

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const colors = SCORE_COLORS[label] ?? SCORE_COLORS.Fair;
  const offset = CIRCUMFERENCE * (1 - score / 100);

  return (
    <div className={cn("relative w-[120px] h-[120px] flex-shrink-0 rounded-full", colors.bg)}>
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          className="stroke-cream-200"
          strokeWidth="8"
        />
        <motion.circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          className={colors.stroke}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          initial={{ strokeDashoffset: CIRCUMFERENCE }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-serif text-warm-700">{score}</span>
        <span className={cn("text-xs font-medium", colors.text)}>{label}</span>
      </div>
    </div>
  );
}

function TrendBadge({ trend }: { trend: HealthTrend }) {
  const config = TREND_CONFIG[trend];
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", config.color)}>
      <Icon className="w-3.5 h-3.5" />
      {config.label}
    </span>
  );
}

function SubScoreCard({ subScore, iconKey, className }: { subScore: HealthSubScore; iconKey: keyof typeof SUB_SCORE_ICONS; className?: string }) {
  const { icon: Icon, color, bg } = SUB_SCORE_ICONS[iconKey];

  return (
    <div className={cn("p-3 rounded-xl bg-cream-50/50", className)}>
      <div className="flex items-center justify-between mb-2">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", bg)}>
          <Icon className={cn("w-4 h-4", color)} />
        </div>
        <TrendBadge trend={subScore.trend} />
      </div>
      <p className="text-[10px] font-medium tracking-wider text-warm-400 uppercase mb-0.5">
        {subScore.label}
      </p>
      <p className="text-lg font-serif text-warm-700">{subScore.score}<span className="text-sm text-warm-300">/100</span></p>
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-cream-200 overflow-hidden">
        <motion.div
          className={cn("h-full rounded-full", scoreBarClass(subScore.score))}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(100, subScore.score))}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
      <p className="text-xs text-warm-300 mt-1.5 line-clamp-2">{subScore.description}</p>
    </div>
  );
}

export function FinancialHealthScore({ healthScore: h }: FinancialHealthScoreProps) {
  const colors = SCORE_COLORS[h.overallLabel] ?? SCORE_COLORS.Fair;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-4">
      {/* Overall Score */}
      <motion.div variants={fadeUp} className="card p-4 sm:p-5">
        <div className="flex flex-row items-center gap-4 sm:gap-5">
          <ScoreGauge score={h.overallScore} label={h.overallLabel} />
          <div className="min-w-0 text-left">
            <h2 className="font-serif text-lg text-warm-700">Financial Health</h2>
            <div className="flex items-center justify-start gap-2 mt-1">
              <TrendBadge trend={h.overallTrend} />
            </div>
            {h.savingsRate !== null && (
              <p className="text-sm text-warm-400 mt-2">
                Savings Rate:{" "}
                <span className={cn("font-medium", h.savingsRate >= 0 ? "text-income" : "text-expense")}>
                  {Math.round(Math.abs(h.savingsRate) * 100)}%
                </span>
                {h.savingsRate < 0 && <span className="text-warm-300"> (deficit)</span>}
              </p>
            )}
            <p className={cn("text-xs mt-1", colors.text)}>
              Your finances are rated <span className="font-medium">{h.overallLabel}</span>
            </p>
          </div>
        </div>
      </motion.div>

      {/* Sub-scores */}
      <motion.div variants={fadeUp} className="card p-4 sm:p-5">
        <h2 className="font-serif text-lg text-warm-700">Score Breakdown</h2>
        <p className="text-xs text-warm-300 mb-3 sm:mb-4">What makes up your financial health score</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <SubScoreCard subScore={h.subScores.savingsRate} iconKey="savingsRate" />
          <SubScoreCard subScore={h.subScores.expenseTrend} iconKey="expenseTrend" />
          <SubScoreCard subScore={h.subScores.incomeStability} iconKey="incomeStability" />
          <SubScoreCard subScore={h.subScores.diversification} iconKey="diversification" />
          <SubScoreCard subScore={h.subScores.consistency} iconKey="consistency" className="col-span-2 sm:col-span-1" />
        </div>
      </motion.div>
    </motion.div>
  );
}
