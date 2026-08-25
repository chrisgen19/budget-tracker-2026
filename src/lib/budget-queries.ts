// The `Prisma` namespace is imported as a value, not just a type, for its JSON null
// sentinels. This module otherwise takes its client by injection and imports only types.
// Prisma's typed API rejects a plain `null` here (`Type 'null' is not assignable to
// 'InputJsonValue | JsonNullValueFilter | ...'`), and the `Record<string, unknown>` shape
// these where-clauses are built as would hide that. It happens to execute correctly on
// 6.19.2, which is exactly why it needs pinning: nothing would catch it changing.
import { Prisma } from "@prisma/client";
import type {
  PrismaClient,
  SpendingByCategoryParams,
  CategorySpending,
  TopExpensesParams,
  TopExpense,
  MonthlySummaryParams,
  MonthSummary,
  SpendingTrendsParams,
  SpendingTrends,
  SearchTransactionsParams,
  SearchTransactionsResult,
  BudgetOverviewParams,
  BudgetOverview,
  UpcomingBillsParams,
  UpcomingBillsResult,
  CategoryListParams,
  CategoryItem,
  LabelBreakdownParams,
  LabelBreakdown,
  LabelBreakdownItem,
  LabelListParams,
  LabelItem,
  BillHistoryParams,
  BillHistory,
  BillOccurrence,
  BillHistorySummary,
  BillOccurrenceStatus,
  ReceiptItemsParams,
  ReceiptItems,
  ReceiptItem,
  DateRange,
} from "./budget-query-types";

/**
 * Parse "YYYY-MM" into the UTC instants bounding that month *in the user's timezone*.
 *
 * Same formula as `/api/dashboard` and `analytics-period.ts` so the whole app agrees on
 * where a month starts. `tzOffset` is `Date.prototype.getTimezoneOffset()` minutes (UTC+8
 * is -480), matching `users.timezone_offset`. It defaults to 0, which reproduces the old
 * UTC-only behaviour for any caller that has no user context.
 */
const parseMonth = (month: string, tzOffset = 0): DateRange => {
  const [year, m] = month.split("-").map(Number);
  const tzMs = tzOffset * 60 * 1000;
  return {
    startDate: new Date(Date.UTC(year, m - 1, 1) + tzMs),
    endDate: new Date(Date.UTC(year, m, 0, 23, 59, 59, 999) + tzMs),
  };
};

/** Shift an instant into the user's local wall clock, to be read via UTC accessors. */
const toLocal = (date: Date, tzOffset: number): Date =>
  new Date(date.getTime() - tzOffset * 60 * 1000);

/** Format a local-shifted date as its "YYYY-MM" month key. */
const monthKey = (local: Date): string =>
  `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Coerce a caller-supplied row limit into something safe to slice or hand to Prisma's `take`.
 *
 * The MCP boundary already rejects bad limits with a protocol error, so this is a second line
 * rather than the first. It earns its place because the failure is silent, not loud:
 * `slice(0, -1)` quietly drops the last row, `slice(0, NaN)` returns nothing, and Prisma reads
 * a negative `take` as "from the end", reversing the window. All three look like real answers.
 *
 * Anything not a positive safe integer falls back to the caller's default, so this never
 * invents or truncates data; telling the caller they were wrong stays the boundary's job.
 */
const safeLimit = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isSafeInteger(value) && value >= 1 ? value : fallback;

/** Get the current month as "YYYY-MM", in the user's timezone. */
const currentMonth = (tzOffset = 0): string => monthKey(toLocal(new Date(), tzOffset));

/**
 * Spending grouped by category for a given month.
 * Returns expense categories sorted by amount (highest first).
 */
export const getSpendingByCategory = async (
  prisma: PrismaClient,
  userId: string,
  params: SpendingByCategoryParams = {}
): Promise<CategorySpending[]> => {
  const tz = params.timezoneOffset ?? 0;
  const { startDate, endDate } = parseMonth(params.month ?? currentMonth(tz), tz);

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      type: "EXPENSE",
      date: { gte: startDate, lte: endDate },
    },
    include: { category: true },
  });

  const categoryMap = new Map<
    string,
    { name: string; color: string; icon: string; amount: number }
  >();

  for (const t of transactions) {
    const existing = categoryMap.get(t.categoryId);
    if (existing) {
      existing.amount += t.amount;
    } else {
      categoryMap.set(t.categoryId, {
        name: t.category.name,
        color: t.category.color,
        icon: t.category.icon,
        amount: t.amount,
      });
    }
  }

  const totalExpenses = transactions.reduce((sum, t) => sum + t.amount, 0);

  return Array.from(categoryMap.entries())
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([categoryId, item]) => ({
      categoryId,
      ...item,
      percentage:
        totalExpenses > 0
          ? Math.round((item.amount / totalExpenses) * 100)
          : 0,
    }));
};

/**
 * Largest individual expense transactions.
 */
export const getTopExpenses = async (
  prisma: PrismaClient,
  userId: string,
  params: TopExpensesParams = {}
): Promise<TopExpense[]> => {
  const limit = safeLimit(params.limit, 10);

  const where: Record<string, unknown> = { userId, type: "EXPENSE" };

  if (params.month) {
    const { startDate, endDate } = parseMonth(params.month, params.timezoneOffset ?? 0);
    where.date = { gte: startDate, lte: endDate };
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true },
    orderBy: { amount: "desc" },
    take: limit,
  });

  return transactions.map((t) => ({
    id: t.id,
    amount: t.amount,
    description: t.description,
    date: t.date.toISOString(),
    categoryName: t.category.name,
    categoryIcon: t.category.icon,
  }));
};

/**
 * Income/expenses/net per month for the last N months.
 */
export const getMonthlySummary = async (
  prisma: PrismaClient,
  userId: string,
  params: MonthlySummaryParams = {}
): Promise<MonthSummary[]> => {
  const months = params.months ?? 6;
  const tz = params.timezoneOffset ?? 0;
  const tzMs = tz * 60 * 1000;
  // "Now" and every bucket edge are the user's local month, not the container's.
  const localNow = toLocal(new Date(), tz);
  const startDate = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth() - (months - 1), 1) + tzMs);
  const endDate = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth() + 1, 0, 23, 59, 59, 999) + tzMs);

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: startDate, lte: endDate },
    },
    select: { amount: true, type: true, date: true },
  });

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const result: MonthSummary[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth() - i, 1));
    const key = monthKey(d);
    const monthLabel = `${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

    const monthTx = transactions.filter(
      (t) => monthKey(toLocal(new Date(t.date), tz)) === key
    );

    const income = monthTx
      .filter((t) => t.type === "INCOME")
      .reduce((sum, t) => sum + t.amount, 0);

    const expenses = monthTx
      .filter((t) => t.type === "EXPENSE")
      .reduce((sum, t) => sum + t.amount, 0);

    result.push({
      month: monthLabel,
      income,
      expenses,
      net: income - expenses,
    });
  }

  return result;
};

/**
 * Compare spending between two months, broken down by category.
 */
export const getSpendingTrends = async (
  prisma: PrismaClient,
  userId: string,
  params: SpendingTrendsParams
): Promise<SpendingTrends> => {
  const tz = params.timezoneOffset ?? 0;
  const [currentSpending, previousSpending] = await Promise.all([
    getSpendingByCategory(prisma, userId, { month: params.currentMonth, timezoneOffset: tz }),
    getSpendingByCategory(prisma, userId, { month: params.previousMonth, timezoneOffset: tz }),
  ]);

  const currentTotal = currentSpending.reduce((sum, c) => sum + c.amount, 0);
  const previousTotal = previousSpending.reduce((sum, c) => sum + c.amount, 0);
  const totalChange = currentTotal - previousTotal;

  // Build a unified category map
  const categoryNames = new Set<string>();
  for (const c of currentSpending) categoryNames.add(c.name);
  for (const c of previousSpending) categoryNames.add(c.name);

  const byCategory = Array.from(categoryNames).map((name) => {
    const curr = currentSpending.find((c) => c.name === name)?.amount ?? 0;
    const prev = previousSpending.find((c) => c.name === name)?.amount ?? 0;
    const change = curr - prev;
    return {
      name,
      current: curr,
      previous: prev,
      change,
      changePercent: prev > 0 ? Math.round((change / prev) * 100) : null,
    };
  });

  // Sort by absolute change descending
  byCategory.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  return {
    currentTotal,
    previousTotal,
    totalChange,
    totalChangePercent:
      previousTotal > 0
        ? Math.round((totalChange / previousTotal) * 100)
        : null,
    byCategory,
  };
};

/**
 * Search transactions with filters, pagination, and sorting.
 */
export const searchTransactions = async (
  prisma: PrismaClient,
  userId: string,
  params: SearchTransactionsParams = {}
): Promise<SearchTransactionsResult> => {
  const page = params.page ?? 1;
  const limit = safeLimit(params.limit, 20);

  const where: Record<string, unknown> = { userId };

  if (params.type) {
    where.type = params.type;
  }

  if (params.month) {
    const { startDate, endDate } = parseMonth(params.month, params.timezoneOffset ?? 0);
    where.date = { gte: startDate, lte: endDate };
  }

  if (params.categoryId) {
    where.categoryId = params.categoryId;
  }

  if (params.createdVia) {
    where.createdVia = params.createdVia;
  }

  if (params.amountMin !== undefined || params.amountMax !== undefined) {
    const amountFilter: Record<string, number> = {};
    if (params.amountMin !== undefined) amountFilter.gte = params.amountMin;
    if (params.amountMax !== undefined) amountFilter.lte = params.amountMax;
    where.amount = amountFilter;
  }

  if (params.search) {
    where.description = { contains: params.search, mode: "insensitive" };
  }

  if (params.labelIds && params.labelIds.length > 0) {
    where.labels = { some: { labelId: { in: params.labelIds } } };
  }

  const direction = params.sortDir === "asc" ? "asc" : "desc";
  const orderBy =
    params.sortBy === "amount"
      ? [
          { amount: direction as "asc" | "desc" },
          { date: "desc" as const },
          { id: "asc" as const },
        ]
      : [
          { date: direction as "asc" | "desc" },
          { createdAt: "desc" as const },
          { id: "asc" as const },
        ];

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { category: true, labels: { include: { label: true } } },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    transactions: transactions.map((t) => ({
      id: t.id,
      amount: t.amount,
      description: t.description,
      type: t.type as "INCOME" | "EXPENSE",
      date: t.date.toISOString(),
      categoryName: t.category.name,
      categoryIcon: t.category.icon,
      categoryColor: t.category.color,
      labels: t.labels.map((tl) => ({
        id: tl.label.id,
        name: tl.label.name,
        color: tl.label.color,
      })),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * High-level monthly summary with running balance.
 */
export const getBudgetOverview = async (
  prisma: PrismaClient,
  userId: string,
  params: BudgetOverviewParams = {}
): Promise<BudgetOverview> => {
  const tz = params.timezoneOffset ?? 0;
  const monthStr = params.month ?? currentMonth(tz);
  const { startDate, endDate } = parseMonth(monthStr, tz);

  const [transactions, runningIncome, runningExpenses] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endDate },
      },
      select: { amount: true, type: true },
    }),

    prisma.transaction.aggregate({
      where: { userId, type: "INCOME", date: { lte: endDate } },
      _sum: { amount: true },
    }),

    prisma.transaction.aggregate({
      where: { userId, type: "EXPENSE", date: { lte: endDate } },
      _sum: { amount: true },
    }),
  ]);

  const totalIncome = transactions
    .filter((t) => t.type === "INCOME")
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = transactions
    .filter((t) => t.type === "EXPENSE")
    .reduce((sum, t) => sum + t.amount, 0);

  const runningBalance =
    (runningIncome._sum.amount ?? 0) - (runningExpenses._sum.amount ?? 0);

  return {
    month: monthStr,
    totalIncome,
    totalExpenses,
    net: totalIncome - totalExpenses,
    runningBalance,
    transactionCount: transactions.length,
  };
};

/**
 * Scheduled transactions due within N days.
 */
export const getUpcomingBills = async (
  prisma: PrismaClient,
  userId: string,
  params: UpcomingBillsParams = {}
): Promise<UpcomingBillsResult> => {
  const days = params.days ?? 7;

  // When a timezone offset is given, anchor "today" to the user's local day (mirrors
  // /api/bills/upcoming) so AI bill context matches what the user sees on the dashboard.
  let today: Date;
  if (params.timezoneOffset !== undefined) {
    const localNow = new Date(Date.now() - params.timezoneOffset * 60 * 1000);
    today = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()));
  } else {
    today = new Date();
    today.setHours(0, 0, 0, 0);
  }

  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + days);

  const bills = await prisma.scheduledTransaction.findMany({
    where: {
      userId,
      isActive: true,
      nextDueDate: { lte: cutoff },
    },
    include: { category: true },
    orderBy: { nextDueDate: "asc" },
  });

  const upcomingBills = bills.map((bill) => {
    const dueDate = new Date(bill.nextDueDate);
    dueDate.setHours(0, 0, 0, 0);

    return {
      id: bill.id,
      description: bill.description || bill.category.name,
      categoryName: bill.category.name,
      categoryIcon: bill.category.icon,
      categoryColor: bill.category.color,
      amount: bill.amount,
      dueDate: bill.nextDueDate.toISOString(),
      isOverdue: dueDate < today,
    };
  });

  const totalAmount = upcomingBills.reduce((sum, b) => sum + b.amount, 0);

  return {
    count: upcomingBills.length,
    totalAmount,
    bills: upcomingBills,
  };
};

/**
 * All categories (default + custom) for the user.
 */
export const getCategoryList = async (
  prisma: PrismaClient,
  userId: string,
  params: CategoryListParams = {}
): Promise<CategoryItem[]> => {
  const where: Record<string, unknown> = {
    OR: [{ isDefault: true }, { userId }],
  };

  if (params.type) {
    where.type = params.type;
  }

  const categories = await prisma.category.findMany({
    where,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type as "INCOME" | "EXPENSE",
    icon: c.icon,
    color: c.color,
    isDefault: c.isDefault,
  }));
};

/**
 * Spending grouped by label for a month.
 *
 * Mirrors the analytics page's LabelBreakdown (`/api/analytics`) rather than defining its own
 * arithmetic, so the same question gets the same answer in both places. In particular a
 * transaction's amount is split evenly across its labels, so a 1000 expense tagged with two
 * labels contributes 500 to each and the label amounts still sum to the period total.
 * `transactionCount` deliberately counts a transaction once per label, so the counts do not.
 */
export const getLabelBreakdown = async (
  prisma: PrismaClient,
  userId: string,
  params: LabelBreakdownParams = {}
): Promise<LabelBreakdown> => {
  const tz = params.timezoneOffset ?? 0;
  const type = params.type ?? "EXPENSE";
  const monthStr = params.month ?? currentMonth(tz);
  const { startDate, endDate } = parseMonth(monthStr, tz);

  const transactions = await prisma.transaction.findMany({
    where: { userId, type, date: { gte: startDate, lte: endDate } },
    include: { labels: { include: { label: true } } },
  });

  const total = transactions.reduce((sum, t) => sum + t.amount, 0);
  const byLabel = new Map<string, LabelBreakdownItem>();
  let unlabeledAmount = 0;
  let unlabeledCount = 0;

  for (const t of transactions) {
    if (t.labels.length === 0) {
      unlabeledAmount += t.amount;
      unlabeledCount += 1;
      continue;
    }

    const share = t.amount / t.labels.length;
    for (const tl of t.labels) {
      const existing = byLabel.get(tl.labelId);
      if (existing) {
        existing.amount += share;
        existing.transactionCount += 1;
      } else {
        byLabel.set(tl.labelId, {
          id: tl.labelId,
          name: tl.label.name,
          color: tl.label.color,
          amount: share,
          percentage: 0,
          transactionCount: 1,
        });
      }
    }
  }

  const pct = (amount: number) => (total > 0 ? Math.round((amount / total) * 100) : 0);

  const labels: LabelBreakdownItem[] = Array.from(byLabel.values()).map((item) => ({
    ...item,
    percentage: pct(item.amount),
  }));

  if (unlabeledCount > 0) {
    labels.push({
      id: "unlabeled",
      name: "Unlabeled",
      color: "#9CA3AF",
      amount: unlabeledAmount,
      percentage: pct(unlabeledAmount),
      transactionCount: unlabeledCount,
    });
  }

  labels.sort((a, b) => b.amount - a.amount);

  return { month: monthStr, type, total, labels };
};

/**
 * The user's labels, with how many transactions carry each and any auto-apply schedules.
 * The counterpart to `getCategoryList`: without it there is no way to discover label IDs.
 */
export const getLabelList = async (
  prisma: PrismaClient,
  userId: string,
  params: LabelListParams = {}
): Promise<LabelItem[]> => {
  const where: Record<string, unknown> = { userId };

  // A "BOTH" label is usable on either type, so it matches any filter.
  if (params.applicableTo) {
    where.applicableTo = { in: [params.applicableTo, "BOTH"] };
  }

  const labels = await prisma.label.findMany({
    where,
    include: {
      _count: { select: { transactions: true } },
      schedules: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { name: "asc" },
  });

  return labels.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    applicableTo: l.applicableTo,
    transactionCount: l._count.transactions,
    schedules: l.schedules.map((sc) => ({
      days: sc.days,
      startTime: sc.startTime,
      endTime: sc.endTime,
    })),
  }));
};

/** Truncate an instant to its calendar day in the user's timezone, as a UTC midnight. */
const localDayStart = (date: Date, tzOffset: number): Date => {
  const local = toLocal(date, tzOffset);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
};

/**
 * Truncate a date-only value to its stored calendar day, with no timezone conversion.
 *
 * Bill due dates carry no time component: they are stored at midnight UTC and mean "the 5th",
 * not an instant. Shifting one into a timezone west of UTC moves it to the 4th, which turns
 * every on-time payment into a day late. Only real instants get `localDayStart`.
 */
const utcDayStart = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** YYYY-MM-DD for a local-shifted date. */
const dayKey = (local: Date): string =>
  `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;

/**
 * N months before a day, clamped to the target month's last day.
 *
 * `Date.UTC(y, m - 6, 31)` for a 31st in a shorter target month overflows forward: six months
 * before Aug 31 becomes Mar 3, silently trimming days off the front of the window.
 */
const monthsBefore = (day: Date, months: number): Date => {
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth() - months;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day.getUTCDate(), lastDayOfTarget)));
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bill occurrence history plus per-bill payment patterns.
 *
 * A scheduled occurrence is a (bill, dueDate) pair, and it can produce several log rows:
 * snoozing deliberately does not settle the occurrence, so it can be snoozed repeatedly and
 * then paid or skipped. Rows are collapsed per occurrence here, so the summary counts
 * scheduled occurrences rather than user actions.
 *
 * Lateness is whole calendar days between the due day and the day of payment. The due date is
 * date-only (stored at midnight UTC, meaning "the 5th"), so it is read as its stored calendar
 * day; only `actionDate`, a real instant, is converted into the user's timezone. Converting
 * both would move the due day backwards for anyone west of UTC and report every on-time
 * payment as a day late.
 *
 * Negative means paid early, which is kept rather than clamped: "usually two days early" is a
 * real answer. Only settled-as-PAID occurrences carry lateness; skipped and outstanding ones
 * have no payment date to be late relative to, so they stay out of the averages.
 */
export const getBillHistory = async (
  prisma: PrismaClient,
  userId: string,
  params: BillHistoryParams = {}
): Promise<BillHistory> => {
  const tz = params.timezoneOffset ?? 0;
  const months = params.months ?? 6;
  const limit = safeLimit(params.limit, 50);

  const today = localDayStart(new Date(), tz);
  const from = monthsBefore(today, months);

  const bills = await prisma.scheduledTransaction.findMany({
    where: { userId, ...(params.billId ? { id: params.billId } : {}) },
    include: { category: true },
  });

  if (bills.length === 0) {
    return { from: dayKey(from), to: dayKey(today), occurrences: [], summaries: [] };
  }

  const billsById = new Map(bills.map((b) => [b.id, b]));

  // The status filter is applied after grouping, against each occurrence's settled outcome.
  // Filtering in the query would drop the sibling rows needed to work that outcome out.
  // Bounded at both ends. /api/bills/upcoming surfaces bills due up to a week ahead and lets
  // them be paid or skipped, which writes a log with a future dueDate; without the upper
  // bound those land in a window this call advertises as ending today. Nothing is lost by
  // excluding them: the window trails, so that due date is picked up once it arrives.
  const logs = await prisma.scheduledTransactionLog.findMany({
    where: {
      scheduledTransactionId: { in: bills.map((b) => b.id) },
      dueDate: { gte: from, lte: today },
    },
    orderBy: { dueDate: "desc" },
  });

  type Group = {
    billId: string;
    dueDate: Date;
    settled: (typeof logs)[number] | null;
    latestSnooze: (typeof logs)[number] | null;
    snoozeCount: number;
  };

  const groups = new Map<string, Group>();

  for (const log of logs) {
    if (!billsById.has(log.scheduledTransactionId)) continue;

    const key = `${log.scheduledTransactionId}:${log.dueDate.getTime()}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        billId: log.scheduledTransactionId,
        dueDate: log.dueDate,
        settled: null,
        latestSnooze: null,
        snoozeCount: 0,
      };
      groups.set(key, group);
    }

    if (log.status === "SNOOZED") {
      group.snoozeCount += 1;
      const current = group.latestSnooze?.actionDate?.getTime() ?? -Infinity;
      if ((log.actionDate?.getTime() ?? -Infinity) >= current) group.latestSnooze = log;
    } else {
      // PAID and SKIPPED are guarded by alreadySettled, so there is at most one per occurrence.
      group.settled = log;
    }
  }

  // The bill's `amount` is its current configuration, not what any past occurrence cost:
  // Pay & Edit can change the amount at pay time, and editing the bill rewrites the nominal
  // amount for all of its history. Read the linked transactions, as /api/bills/[id]/history
  // already does, so a paid occurrence reports what was actually recorded.
  const transactionIds = Array.from(groups.values())
    .map((g) => g.settled?.transactionId)
    .filter((id): id is string => Boolean(id));

  const paidAmounts = new Map<string, number>(
    transactionIds.length > 0
      ? (
          await prisma.transaction.findMany({
            where: { id: { in: transactionIds } },
            select: { id: true, amount: true },
          })
        ).map((t) => [t.id, t.amount])
      : []
  );

  const occurrences: BillOccurrence[] = [];
  const stats = new Map<string, BillHistorySummary & { _lateDays: number[] }>();

  const ordered = Array.from(groups.values()).sort(
    (a, b) => b.dueDate.getTime() - a.dueDate.getTime()
  );

  for (const group of ordered) {
    const bill = billsById.get(group.billId)!;
    const record = group.settled ?? group.latestSnooze!;
    const status = (group.settled ? group.settled.status : "SNOOZED") as BillOccurrenceStatus;

    if (params.status && status !== params.status) continue;

    let daysLate: number | null = null;
    if (status === "PAID" && record.actionDate) {
      const due = utcDayStart(group.dueDate);
      const acted = localDayStart(record.actionDate, tz);
      daysLate = Math.round((acted.getTime() - due.getTime()) / DAY_MS);
    }

    occurrences.push({
      billId: bill.id,
      billDescription: bill.description || bill.category.name,
      categoryName: bill.category.name,
      amount: bill.amount,
      paidAmount: group.settled?.transactionId
        ? paidAmounts.get(group.settled.transactionId) ?? null
        : null,
      dueDate: group.dueDate.toISOString(),
      status,
      actionDate: record.actionDate?.toISOString() ?? null,
      daysLate,
      snoozeCount: group.snoozeCount,
      transactionId: group.settled?.transactionId ?? null,
      snoozeUntil: group.latestSnooze?.snoozeUntil?.toISOString() ?? null,
    });

    let entry = stats.get(bill.id);
    if (!entry) {
      entry = {
        billId: bill.id,
        description: bill.description || bill.category.name,
        categoryName: bill.category.name,
        occurrences: 0,
        paid: 0,
        skipped: 0,
        snoozed: 0,
        totalSnoozes: 0,
        paidOnTime: 0,
        paidLate: 0,
        avgDaysLate: null,
        maxDaysLate: null,
        _lateDays: [],
      };
      stats.set(bill.id, entry);
    }

    entry.occurrences += 1;
    entry.totalSnoozes += group.snoozeCount;
    if (status === "PAID") entry.paid += 1;
    else if (status === "SKIPPED") entry.skipped += 1;
    else entry.snoozed += 1;

    if (daysLate !== null) {
      entry._lateDays.push(daysLate);
      if (daysLate > 0) entry.paidLate += 1;
      else entry.paidOnTime += 1;
    }
  }

  const summaries: BillHistorySummary[] = Array.from(stats.values()).map((e) => {
    const { _lateDays, ...rest } = e;
    return {
      ...rest,
      avgDaysLate:
        _lateDays.length > 0
          ? Math.round((_lateDays.reduce((a, b) => a + b, 0) / _lateDays.length) * 10) / 10
          : null,
      maxDaysLate: _lateDays.length > 0 ? Math.max(..._lateDays) : null,
    };
  });

  // Worst offenders first; bills with no measurable lateness sort last.
  summaries.sort((a, b) => (b.avgDaysLate ?? -Infinity) - (a.avgDaysLate ?? -Infinity));

  return {
    from: dayKey(from),
    to: dayKey(today),
    occurrences: occurrences.slice(0, limit),
    summaries,
  };
};

/**
 * Narrow a stored `receipt_breakdown` blob into items.
 *
 * The column is `Json?`, so this arrives as `unknown`. It is validated rather than cast:
 * a partially written or hand-edited blob must be skipped, not turned into items holding
 * `undefined` (see the 2026-08-20 entry, where casting scan responses without checking
 * produced exactly that).
 */
const parseReceiptBreakdown = (
  raw: unknown
): { total: number; items: Array<{ name: string; amount: number }> } | null => {
  if (typeof raw !== "object" || raw === null) return null;

  const blob = raw as Record<string, unknown>;
  if (!Array.isArray(blob.items)) return null;

  const items: Array<{ name: string; amount: number }> = [];
  for (const entry of blob.items) {
    if (typeof entry !== "object" || entry === null) continue;
    const { name, amount } = entry as Record<string, unknown>;
    if (typeof name !== "string" || typeof amount !== "number" || !Number.isFinite(amount)) {
      continue;
    }
    items.push({ name, amount });
  }

  if (items.length === 0) return null;

  const total =
    typeof blob.total === "number" && Number.isFinite(blob.total)
      ? blob.total
      : items.reduce((sum, i) => sum + i.amount, 0);

  return { total, items };
};

/**
 * Individual line items from scanned receipts, flattened across transactions.
 *
 * Flat rather than nested by receipt because the common questions aggregate across receipts
 * ("how much on eggs this month?"), which is far easier over a list than a tree. Each item
 * carries its `receiptGroupId`, so a caller can pass that back to pull one whole receipt.
 */
export const getReceiptItems = async (
  prisma: PrismaClient,
  userId: string,
  params: ReceiptItemsParams = {}
): Promise<ReceiptItems> => {
  const tz = params.timezoneOffset ?? 0;
  const limit = safeLimit(params.limit, 100);

  // DbNull is "the column is SQL NULL", as opposed to a stored JSON `null`. Both are
  // excluded in practice: parseReceiptBreakdown rejects a JSON null too.
  const where: Record<string, unknown> = {
    userId,
    NOT: { receiptBreakdown: { equals: Prisma.DbNull } },
  };

  if (params.month) {
    const { startDate, endDate } = parseMonth(params.month, tz);
    where.date = { gte: startDate, lte: endDate };
  }

  if (params.receiptGroupId) {
    where.receiptGroupId = params.receiptGroupId;
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true },
    orderBy: [{ date: "desc" }, { id: "asc" }],
  });

  const needle = params.search?.toLowerCase();
  const items: ReceiptItem[] = [];

  for (const t of transactions) {
    const breakdown = parseReceiptBreakdown(t.receiptBreakdown);
    if (!breakdown) continue;

    for (const item of breakdown.items) {
      if (needle && !item.name.toLowerCase().includes(needle)) continue;

      items.push({
        name: item.name,
        amount: item.amount,
        transactionId: t.id,
        transactionDescription: t.description,
        transactionAmount: t.amount,
        categoryName: t.category.name,
        date: t.date.toISOString(),
        receiptGroupId: t.receiptGroupId ?? null,
        breakdownTotal: breakdown.total,
      });
    }
  }

  return {
    month: params.month ?? null,
    itemCount: items.length,
    totalAmount: items.reduce((sum, i) => sum + i.amount, 0),
    items: items.slice(0, limit),
  };
};
