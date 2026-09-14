import type { CreditAccount, CreditChargeKind, Prisma } from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Rows returned per list on a card's detail read. A statement month is tens of lines, not hundreds. */
export const MAX_CARD_PERIOD_ROWS = 500;

export interface LedgerTotals {
  /** Purchases, fees and interest: what the card added to the debt. */
  charges: number;
  /** Refunds and reversals: what the card took back off it. */
  credits: number;
  /** Expense transactions linked to the card: what was paid from the bank. */
  payments: number;
}

const emptyTotals = (): LedgerTotals => ({ charges: 0, credits: 0, payments: 0 });

/**
 * What is owed on a card. Positive is debt. Negative means the card holds a credit, which an
 * overpayment or a refund after payment legitimately produces, so it is not clamped away.
 */
export const computeAccountBalance = (openingBalance: number, totals: LedgerTotals): number =>
  round2(openingBalance + totals.charges - totals.credits - totals.payments);

export interface DateWindow {
  start: Date;
  end: Date;
}

/**
 * A calendar month in the user's timezone, as the instants bounding it (both inclusive).
 *
 * The same `Date.UTC(y, m, d) + tzOffset * 60000` formula every other period in the app uses, so a
 * card's month and the dashboard's month cannot disagree about which day a row belongs to.
 */
export const monthWindow = (month: string, timezoneOffset: number): DateWindow => {
  const [year, monthNumber] = month.split("-").map(Number);
  const offsetMs = timezoneOffset * 60_000;
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1) + offsetMs),
    end: new Date(Date.UTC(year, monthNumber, 1) + offsetMs - 1),
  };
};

/** The user's current month as `YYYY-MM`. */
export const currentMonthKey = (timezoneOffset: number, now: Date = new Date()): string => {
  const local = new Date(now.getTime() - timezoneOffset * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** The offset every card read and write resolves calendar days with. */
export const readTimezoneOffset = async (prisma: PrismaClient, userId: string): Promise<number> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezoneOffset: true },
  });
  return user?.timezoneOffset ?? 0;
};

interface ChargeGroup {
  accountId: string;
  kind: CreditChargeKind;
  _sum: { amount: number | null };
}

interface PaymentGroup {
  creditAccountId: string | null;
  _sum: { amount: number | null };
}

/** Folds grouped sums into per-card totals. Pure, so the arithmetic is testable without a database. */
export const foldLedgerGroups = (
  accountIds: readonly string[],
  chargeGroups: readonly ChargeGroup[],
  paymentGroups: readonly PaymentGroup[]
): Map<string, LedgerTotals> => {
  const totals = new Map(accountIds.map((id) => [id, emptyTotals()]));

  for (const group of chargeGroups) {
    const entry = totals.get(group.accountId);
    if (!entry) continue;
    if (group.kind === "CREDIT") entry.credits += group._sum.amount ?? 0;
    else entry.charges += group._sum.amount ?? 0;
  }
  for (const group of paymentGroups) {
    const entry = group.creditAccountId ? totals.get(group.creditAccountId) : undefined;
    if (entry) entry.payments += group._sum.amount ?? 0;
  }

  for (const entry of totals.values()) {
    entry.charges = round2(entry.charges);
    entry.credits = round2(entry.credits);
    entry.payments = round2(entry.payments);
  }
  return totals;
};

/** Every card's ledger in two grouped queries, rather than two per card. */
const sumLedgers = async (
  prisma: PrismaClient,
  userId: string,
  accountIds: string[],
  window?: DateWindow
): Promise<Map<string, LedgerTotals>> => {
  if (accountIds.length === 0) return new Map();
  const date = window ? { gte: window.start, lte: window.end } : undefined;

  const [chargeGroups, paymentGroups] = await Promise.all([
    prisma.creditCharge.groupBy({
      by: ["accountId", "kind"],
      where: { userId, accountId: { in: accountIds }, ...(date && { date }) },
      _sum: { amount: true },
    }),
    prisma.transaction.groupBy({
      by: ["creditAccountId"],
      where: { userId, type: "EXPENSE", creditAccountId: { in: accountIds }, ...(date && { date }) },
      _sum: { amount: true },
    }),
  ]);

  return foldLedgerGroups(accountIds, chargeGroups, paymentGroups);
};

export interface CreditAccountSummary {
  id: string;
  name: string;
  color: string;
  creditLimit: number | null;
  statementDay: number | null;
  dueDay: number | null;
  openingBalance: number;
  openingBalanceDate: Date;
  isActive: boolean;
  billId: string | null;
  /** What is owed right now, across the card's whole history. */
  balance: number;
  /** Limit minus balance, or null with no limit recorded. Not clamped: being over it is worth seeing. */
  availableCredit: number | null;
  /** All-time totals behind `balance`. */
  totals: LedgerTotals;
}

const toSummary = (account: CreditAccount, totals: LedgerTotals): CreditAccountSummary => {
  const balance = computeAccountBalance(account.openingBalance, totals);
  return {
    id: account.id,
    name: account.name,
    color: account.color,
    creditLimit: account.creditLimit,
    statementDay: account.statementDay,
    dueDay: account.dueDay,
    openingBalance: account.openingBalance,
    openingBalanceDate: account.openingBalanceDate,
    isActive: account.isActive,
    billId: account.billId,
    balance,
    availableCredit: account.creditLimit === null ? null : round2(account.creditLimit - balance),
    totals,
  };
};

/** The user's cards with what each one owes. Archived cards only when asked for. */
export const getCreditAccountSummaries = async (
  prisma: PrismaClient,
  userId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<CreditAccountSummary[]> => {
  const accounts = await prisma.creditAccount.findMany({
    where: { userId, ...(includeArchived ? {} : { isActive: true }) },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  const totals = await sumLedgers(prisma, userId, accounts.map((account) => account.id));
  return accounts.map((account) => toSummary(account, totals.get(account.id) ?? emptyTotals()));
};

export interface CardCategorySpend {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  amount: number;
  percentage: number;
}

interface CategoryChargeGroup {
  categoryId: string;
  kind: CreditChargeKind;
  _sum: { amount: number | null };
}

/**
 * What the card was spent on in a period, net of refunds.
 *
 * A category a refund fully cancels is dropped rather than shown at zero, and one it overshoots is
 * dropped too: a negative slice has no meaning in a breakdown of spending.
 */
export const buildCardCategoryBreakdown = (
  groups: readonly CategoryChargeGroup[],
  categories: ReadonlyMap<string, { name: string; icon: string; color: string }>
): CardCategorySpend[] => {
  const net = new Map<string, number>();
  for (const group of groups) {
    const signed = (group.kind === "CREDIT" ? -1 : 1) * (group._sum.amount ?? 0);
    net.set(group.categoryId, (net.get(group.categoryId) ?? 0) + signed);
  }

  const rows = [...net.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount: round2(amount) }))
    .filter((row) => row.amount > 0 && categories.has(row.categoryId))
    .sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);

  return rows.map((row) => ({
    ...row,
    ...categories.get(row.categoryId)!,
    percentage: total > 0 ? Math.round((row.amount / total) * 100) : 0,
  }));
};

/** The shape a charge is returned in, by reads and writes alike. */
export const CHARGE_ROW_INCLUDE = {
  category: { select: { id: true, name: true, icon: true, color: true } },
} as const;

export type CreditChargeRow = Prisma.CreditChargeGetPayload<{ include: typeof CHARGE_ROW_INCLUDE }>;

const PAYMENT_ROW_SELECT = {
  id: true,
  amount: true,
  description: true,
  date: true,
  billId: true,
} as const;

export type CardPaymentRow = Prisma.TransactionGetPayload<{ select: typeof PAYMENT_ROW_SELECT }>;

export interface CreditAccountDetail {
  account: CreditAccountSummary;
  period: { month: string; start: Date; end: Date; totals: LedgerTotals };
  charges: CreditChargeRow[];
  payments: CardPaymentRow[];
  /** True when either list hit `MAX_CARD_PERIOD_ROWS`. Totals and the breakdown stay complete. */
  truncated: boolean;
  categoryBreakdown: CardCategorySpend[];
}

/**
 * One card for one month: what it owes overall, and what moved in that month.
 *
 * The breakdown is grouped in SQL rather than folded from the row list, so it stays whole even when
 * a list is capped.
 */
export const getCreditAccountDetail = async (
  prisma: PrismaClient,
  userId: string,
  accountId: string,
  month: string,
  timezoneOffset: number
): Promise<CreditAccountDetail | null> => {
  const account = await prisma.creditAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) return null;

  const window = monthWindow(month, timezoneOffset);
  const date = { gte: window.start, lte: window.end };
  const order = [{ date: "desc" as const }, { createdAt: "desc" as const }];

  const [allTime, inPeriod, charges, payments, categoryGroups] = await Promise.all([
    sumLedgers(prisma, userId, [account.id]),
    sumLedgers(prisma, userId, [account.id], window),
    prisma.creditCharge.findMany({
      where: { userId, accountId: account.id, date },
      include: CHARGE_ROW_INCLUDE,
      orderBy: order,
      take: MAX_CARD_PERIOD_ROWS,
    }),
    prisma.transaction.findMany({
      where: { userId, type: "EXPENSE", creditAccountId: account.id, date },
      select: PAYMENT_ROW_SELECT,
      orderBy: order,
      take: MAX_CARD_PERIOD_ROWS,
    }),
    prisma.creditCharge.groupBy({
      by: ["categoryId", "kind"],
      where: { userId, accountId: account.id, date },
      _sum: { amount: true },
    }),
  ]);

  const categories = await prisma.category.findMany({
    where: { id: { in: [...new Set(categoryGroups.map((group) => group.categoryId))] } },
    select: { id: true, name: true, icon: true, color: true },
  });

  return {
    account: toSummary(account, allTime.get(account.id) ?? emptyTotals()),
    period: { month, ...window, totals: inPeriod.get(account.id) ?? emptyTotals() },
    charges,
    payments,
    truncated: charges.length === MAX_CARD_PERIOD_ROWS || payments.length === MAX_CARD_PERIOD_ROWS,
    categoryBreakdown: buildCardCategoryBreakdown(
      categoryGroups,
      new Map(categories.map(({ id, ...meta }) => [id, meta]))
    ),
  };
};
