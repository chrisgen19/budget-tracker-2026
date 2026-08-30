import type { TransactionType } from "@/lib/budget-query-types";
import { isSpending } from "@/lib/transfer-filters";
import type {
  AnalyticsCategoryTrendPoint,
  AnalyticsCategoryTrendSeries,
  AnalyticsCategoryTrends,
  AnalyticsGranularity,
  AnalyticsTopTransaction,
} from "@/types";
import { MONTH_NAMES, toBucketKey } from "@/lib/analytics-buckets";

const OTHER_SERIES_COLOR = "#9CA3AF";

interface TrendTransaction {
  amount: number;
  type: string;
  date: Date;
  categoryId: string;
  category: { name: string; color: string; icon: string };
}

type CategoryTotals = Map<string, { meta: TrendTransaction["category"]; total: number }>;

/** Single pass over expenses: per-category totals + per-bucket per-category amounts. */
const aggregateExpenses = (
  transactions: TrendTransaction[],
  granularity: AnalyticsGranularity,
  tzMs: number,
): { totals: CategoryTotals; byBucket: Map<string, Map<string, number>> } => {
  const totals: CategoryTotals = new Map();
  const byBucket = new Map<string, Map<string, number>>();

  for (const t of transactions) {
    if (t.type !== "EXPENSE") continue;
    const entry = totals.get(t.categoryId) ?? { meta: t.category, total: 0 };
    entry.total += t.amount;
    totals.set(t.categoryId, entry);

    const key = toBucketKey(t.date, granularity, tzMs);
    const bucket = byBucket.get(key) ?? new Map<string, number>();
    bucket.set(t.categoryId, (bucket.get(t.categoryId) ?? 0) + t.amount);
    byBucket.set(key, bucket);
  }

  return { totals, byBucket };
};

/** Top N categories by total become series; the rest roll into one "Other" series. */
const buildSeries = (
  totals: CategoryTotals,
  topN: number,
): { series: AnalyticsCategoryTrendSeries[]; otherIds: Set<string> } => {
  const ranked = Array.from(totals.entries()).sort((a, b) => b[1].total - a[1].total);
  const top = ranked.slice(0, topN);
  const rest = ranked.slice(topN);
  const otherIds = new Set(rest.map(([id]) => id));

  const series: AnalyticsCategoryTrendSeries[] = top.map(([id, { meta, total }]) => ({
    id,
    name: meta.name,
    color: meta.color,
    icon: meta.icon,
    total,
  }));
  if (rest.length > 0) {
    series.push({
      id: "other",
      name: "Other",
      color: OTHER_SERIES_COLOR,
      icon: "MoreHorizontal",
      total: rest.reduce((sum, [, e]) => sum + e.total, 0),
    });
  }

  return { series, otherIds };
};

/** Per-bucket amounts for the top expense categories, with the rest rolled into "Other". */
export const computeCategoryTrends = (
  transactions: TrendTransaction[],
  bucketKeys: string[],
  bucketLabels: Map<string, string>,
  granularity: AnalyticsGranularity,
  tzMs: number,
  topN = 5,
): AnalyticsCategoryTrends => {
  const { totals, byBucket } = aggregateExpenses(transactions, granularity, tzMs);
  const { series, otherIds } = buildSeries(totals, topN);

  const points: AnalyticsCategoryTrendPoint[] = bucketKeys.map((key) => {
    const values: Record<string, number> = {};
    for (const s of series) values[s.id] = 0;
    const bucket = byBucket.get(key);
    if (bucket) {
      for (const [catId, amount] of bucket) {
        const seriesId = otherIds.has(catId) ? "other" : catId;
        values[seriesId] = (values[seriesId] ?? 0) + amount;
      }
    }
    return { period: key, periodLabel: bucketLabels.get(key) ?? key, values };
  });

  return { series, points };
};

interface TopTransactionInput {
  id: string;
  amount: number;
  /** Widened when transfers arrived. `selectTopTransactions` drops them: "your biggest
   *  transactions" means spending, and a card bill payment is the largest row of most months
   *  while being none of it. */
  type: TransactionType;
  description: string;
  date: Date;
  category: { name: string; color: string; icon: string };
  labels?: Array<{ labelId: string; label: { name: string; color: string } }>;
}

/** The largest transactions in the period, mapped to a display-ready DTO. */
export const selectTopTransactions = (
  transactions: TopTransactionInput[],
  tzMs: number,
  multiYear: boolean,
  limit = 5,
): AnalyticsTopTransaction[] =>
  transactions
    .filter(isSpending)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((t) => {
      const local = new Date(t.date.getTime() - tzMs);
      const y = local.getUTCFullYear();
      const date = `${y}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
      const dayLabel = `${MONTH_NAMES[local.getUTCMonth()]} ${local.getUTCDate()}`;
      return {
        id: t.id,
        amount: t.amount,
        type: t.type,
        description: t.description || t.category.name,
        date,
        dateLabel: multiYear ? `${dayLabel}, ${y}` : dayLabel,
        categoryName: t.category.name,
        categoryIcon: t.category.icon,
        categoryColor: t.category.color,
        labels: (t.labels ?? []).map((tl) => ({ id: tl.labelId, name: tl.label.name, color: tl.label.color })),
      };
    });
