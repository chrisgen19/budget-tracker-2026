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
  DateRange,
} from "./budget-query-types";

/** Parse "YYYY-MM" into a UTC start/end date range for that month */
const parseMonth = (month: string): DateRange => {
  const [year, m] = month.split("-").map(Number);
  return {
    startDate: new Date(Date.UTC(year, m - 1, 1)),
    endDate: new Date(Date.UTC(year, m, 0, 23, 59, 59, 999)),
  };
};

/** Get current month as "YYYY-MM" */
const currentMonth = (): string => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};

/**
 * Spending grouped by category for a given month.
 * Returns expense categories sorted by amount (highest first).
 */
export const getSpendingByCategory = async (
  prisma: PrismaClient,
  userId: string,
  params: SpendingByCategoryParams = {}
): Promise<CategorySpending[]> => {
  const { startDate, endDate } = parseMonth(params.month ?? currentMonth());

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
  const limit = params.limit ?? 10;

  const where: Record<string, unknown> = { userId, type: "EXPENSE" };

  if (params.month) {
    const { startDate, endDate } = parseMonth(params.month);
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
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

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
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthLabel = `${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

    const monthTx = transactions.filter((t) => {
      const td = new Date(t.date);
      return (
        `${td.getUTCFullYear()}-${String(td.getUTCMonth() + 1).padStart(2, "0")}` ===
        monthKey
      );
    });

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
  const [currentSpending, previousSpending] = await Promise.all([
    getSpendingByCategory(prisma, userId, { month: params.currentMonth }),
    getSpendingByCategory(prisma, userId, { month: params.previousMonth }),
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
  const limit = params.limit ?? 20;

  const where: Record<string, unknown> = { userId };

  if (params.type) {
    where.type = params.type;
  }

  if (params.month) {
    const [year, m] = params.month.split("-").map(Number);
    where.date = {
      gte: new Date(Date.UTC(year, m - 1, 1)),
      lt: new Date(Date.UTC(year, m, 1)),
    };
  }

  if (params.categoryId) {
    where.categoryId = params.categoryId;
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
      include: { category: true },
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
  const monthStr = params.month ?? currentMonth();
  const { startDate, endDate } = parseMonth(monthStr);

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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
