import type { CreditAccount, CreditPayment, CreditPaymentKind, Prisma } from "@prisma/client";
import type { PrismaClient } from "@/lib/budget-query-types";
import { buildLabelBreakdown } from "@/lib/budget-queries";
import { sumOwedOnCards } from "@/lib/card-owed";
import { INTEREST_CATEGORY_NAME, type CardInterestFacts } from "@/lib/card-interest";

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Rows returned per list on a card's detail read. A card's month is tens of rows, not hundreds. */
export const MAX_CARD_PERIOD_ROWS = 500;

export interface LedgerTotals {
  /** Expenses paid with the card: what was bought on it. */
  purchases: number;
  /** Money sent to the card from the bank. */
  payments: number;
  /** Refunds and reversals the card issued. */
  credits: number;
}

const emptyTotals = (): LedgerTotals => ({ purchases: 0, payments: 0, credits: 0 });

/**
 * What is owed on a card. Positive is debt. Negative means the card holds a credit, which an
 * overpayment or a refund after payment legitimately produces, so it is not clamped away.
 */
export const computeAccountBalance = (openingBalance: number, totals: LedgerTotals): number =>
  round2(openingBalance + totals.purchases - totals.payments - totals.credits);

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

interface PurchaseGroup {
  creditAccountId: string | null;
  _sum: { amount: number | null };
}

interface PaymentGroup {
  accountId: string;
  kind: CreditPaymentKind;
  _sum: { amount: number | null };
}

/** Folds grouped sums into per-card totals. Pure, so the arithmetic is testable without a database. */
export const foldLedgerGroups = (
  accountIds: readonly string[],
  purchaseGroups: readonly PurchaseGroup[],
  paymentGroups: readonly PaymentGroup[]
): Map<string, LedgerTotals> => {
  const totals = new Map(accountIds.map((id) => [id, emptyTotals()]));

  for (const group of purchaseGroups) {
    const entry = group.creditAccountId ? totals.get(group.creditAccountId) : undefined;
    if (entry) entry.purchases += group._sum.amount ?? 0;
  }
  for (const group of paymentGroups) {
    const entry = totals.get(group.accountId);
    if (!entry) continue;
    if (group.kind === "CREDIT") entry.credits += group._sum.amount ?? 0;
    else entry.payments += group._sum.amount ?? 0;
  }

  for (const entry of totals.values()) {
    entry.purchases = round2(entry.purchases);
    entry.payments = round2(entry.payments);
    entry.credits = round2(entry.credits);
  }
  return totals;
};

/**
 * Every card's ledger in two grouped queries, rather than two per card. Bounded to a month's window,
 * or to everything up to `asOf`, or neither for all time.
 */
const sumLedgers = async (
  prisma: PrismaClient,
  userId: string,
  accountIds: string[],
  window?: DateWindow,
  asOf?: Date
): Promise<Map<string, LedgerTotals>> => {
  if (accountIds.length === 0) return new Map();
  const date = window ? { gte: window.start, lte: window.end } : asOf ? { lte: asOf } : undefined;

  const [purchaseGroups, paymentGroups] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["creditAccountId"],
      where: { userId, type: "EXPENSE", creditAccountId: { in: accountIds }, ...(date && { date }) },
      _sum: { amount: true },
    }),
    prisma.creditPayment.groupBy({
      by: ["accountId", "kind"],
      where: { userId, accountId: { in: accountIds }, ...(date && { date }) },
      _sum: { amount: true },
    }),
  ]);

  return foldLedgerGroups(accountIds, purchaseGroups, paymentGroups);
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
  /** What is owed across the card's whole history, or up to `asOf` when one was asked for. */
  balance: number;
  /** Limit minus balance, or null with no limit recorded. Not clamped: being over it is worth seeing. */
  availableCredit: number | null;
  /** All-time totals behind `balance`. */
  totals: LedgerTotals;
}

/**
 * The opening balance as it stood at `asOf`. It is what the card owed on its opening date, so a
 * period that ended before that date knows nothing of it.
 */
export const openingBalanceAsOf = (
  account: { openingBalance: number; openingBalanceDate: Date },
  asOf?: Date
): number =>
  !asOf || account.openingBalanceDate.getTime() <= asOf.getTime() ? account.openingBalance : 0;

const toSummary = (account: CreditAccount, totals: LedgerTotals, asOf?: Date): CreditAccountSummary => {
  const balance = computeAccountBalance(openingBalanceAsOf(account, asOf), totals);
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

/**
 * The user's cards with what each one owes. Archived cards only when asked for. `asOf` counts only
 * what had happened by that instant, for a view of a month that has already ended.
 */
export const getCreditAccountSummaries = async (
  prisma: PrismaClient,
  userId: string,
  { includeArchived = false, asOf }: { includeArchived?: boolean; asOf?: Date } = {}
): Promise<CreditAccountSummary[]> => {
  const accounts = await prisma.creditAccount.findMany({
    where: { userId, ...(includeArchived ? {} : { isActive: true }) },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  const totals = await sumLedgers(prisma, userId, accounts.map((account) => account.id), undefined, asOf);
  return accounts.map((account) => toSummary(account, totals.get(account.id) ?? emptyTotals(), asOf));
};

/**
 * What the user's cards owe together as of `asOf`, archived ones included. See `sumOwedOnCards`.
 *
 * What is still to be paid to the banks. A purchase on a card lowers the dashboard's Running Balance
 * the day it is made, while the money only leaves the bank when the card is paid, so this explains
 * the gap to cash in the bank, less any opening balance: that debt predates tracking and was never
 * logged as spending. The running balance stops at the end of the month shown, so this has to stop
 * there too, or a past month would pair its balance with today's debt.
 */
export const getOwedOnCards = async (
  prisma: PrismaClient,
  userId: string,
  asOf?: Date
): Promise<number | null> =>
  sumOwedOnCards(await getCreditAccountSummaries(prisma, userId, { includeArchived: true, asOf }));

export interface CardCategorySpend {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  amount: number;
  percentage: number;
}

/** What the card was spent on in a period, largest first. */
export const buildCardCategoryBreakdown = (
  groups: readonly { categoryId: string; _sum: { amount: number | null } }[],
  categories: ReadonlyMap<string, { name: string; icon: string; color: string }>
): CardCategorySpend[] => {
  const rows = groups
    .map((group) => ({ categoryId: group.categoryId, amount: round2(group._sum.amount ?? 0) }))
    .filter((row) => row.amount > 0 && categories.has(row.categoryId))
    .sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);

  return rows.map((row) => ({
    ...row,
    ...categories.get(row.categoryId)!,
    percentage: total > 0 ? Math.round((row.amount / total) * 100) : 0,
  }));
};

const LABEL_LINKS_SELECT = {
  select: { labelId: true, label: { select: { name: true, color: true } } },
} as const;

/** The shape a purchase is listed in on a card's page. */
export const PURCHASE_ROW_SELECT = {
  id: true,
  amount: true,
  description: true,
  date: true,
  categoryId: true,
  category: { select: { id: true, name: true, icon: true, color: true } },
  labels: LABEL_LINKS_SELECT,
} as const;

export type CardPurchaseRow = Prisma.TransactionGetPayload<{ select: typeof PURCHASE_ROW_SELECT }>;

export interface CreditAccountDetail {
  account: CreditAccountSummary;
  period: { month: string; start: Date; end: Date; totals: LedgerTotals };
  purchases: CardPurchaseRow[];
  payments: CreditPayment[];
  /** True when either list hit `MAX_CARD_PERIOD_ROWS`. Totals and both breakdowns stay complete. */
  truncated: boolean;
  categoryBreakdown: CardCategorySpend[];
  /** Same arithmetic as analytics: a purchase counts in full under every label it carries. */
  labelBreakdown: ReturnType<typeof buildLabelBreakdown>;
  /** Interest and fees on this card. See `card-interest.ts` for why the two fields are separate. */
  interest: CardInterestFacts;
}

/**
 * One card for one month: what it owes overall, and what was bought and paid in that month.
 *
 * Both breakdowns read every purchase in the month, not the capped list, so they stay whole.
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
  const purchaseWhere = { userId, type: "EXPENSE" as const, creditAccountId: account.id, date };
  const order = [{ date: "desc" as const }, { createdAt: "desc" as const }];

  // Matched on the category *name*, so a user's own same-named category counts alongside the
  // seeded default, and nothing has to resolve an id before it can ask.
  const interestWhere = { category: { name: INTEREST_CATEGORY_NAME } };

  const [allTime, inPeriod, purchases, payments, categoryGroups, labelRows, interestPeriod, interestEver] =
    await Promise.all([
      sumLedgers(prisma, userId, [account.id]),
      sumLedgers(prisma, userId, [account.id], window),
      prisma.transaction.findMany({ where: purchaseWhere, select: PURCHASE_ROW_SELECT, orderBy: order, take: MAX_CARD_PERIOD_ROWS }),
      prisma.creditPayment.findMany({ where: { userId, accountId: account.id, date }, orderBy: order, take: MAX_CARD_PERIOD_ROWS }),
      prisma.transaction.groupBy({ by: ["categoryId"], where: purchaseWhere, _sum: { amount: true } }),
      prisma.transaction.findMany({ where: purchaseWhere, select: { amount: true, labels: LABEL_LINKS_SELECT } }),
      prisma.transaction.aggregate({ where: { ...purchaseWhere, ...interestWhere }, _sum: { amount: true } }),
      // All time, and deliberately not clipped to the window: "have we ever tracked this" is a
      // property of the card, not of the month on screen.
      prisma.transaction.count({
        where: { userId, type: "EXPENSE" as const, creditAccountId: account.id, ...interestWhere },
      }),
    ]);

  const categories = await prisma.category.findMany({
    where: { id: { in: categoryGroups.map((group) => group.categoryId) } },
    select: { id: true, name: true, icon: true, color: true },
  });
  const monthTotal = labelRows.reduce((sum, row) => sum + row.amount, 0);

  return {
    account: toSummary(account, allTime.get(account.id) ?? emptyTotals()),
    period: { month, ...window, totals: inPeriod.get(account.id) ?? emptyTotals() },
    purchases,
    payments,
    truncated: purchases.length === MAX_CARD_PERIOD_ROWS || payments.length === MAX_CARD_PERIOD_ROWS,
    categoryBreakdown: buildCardCategoryBreakdown(
      categoryGroups,
      new Map(categories.map(({ id, ...meta }) => [id, meta]))
    ),
    labelBreakdown: buildLabelBreakdown(labelRows, monthTotal),
    interest: { period: round2(interestPeriod._sum.amount ?? 0), everLogged: interestEver > 0 },
  };
};
