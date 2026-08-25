/**
 * Declared output shapes for every tool.
 *
 * The SDK does *not* validate `structuredContent` against these at runtime: a tool declaring
 * `{ total: z.number() }` and returning `{ total: "oops" }` is passed straight through. A
 * schema that drifts from what the query layer actually returns would therefore not fail
 * loudly, it would quietly misinform every client that trusts it.
 *
 * So each schema is pinned to the type `src/lib/budget-query-types.ts` already defines, with a
 * compile-time equality assertion. Adding, removing, or retyping a field on either side stops
 * `pnpm type-check` from passing, and CI runs that for this package (see #102).
 */
import { z } from "zod";
import type {
  CategorySpending,
  TopExpense,
  MonthSummary,
  SpendingTrends,
  SearchTransactionsResult,
  BudgetOverview,
  UpcomingBillsResult,
  CategoryItem,
  LabelBreakdown,
  LabelItem,
  BillHistory,
  ReceiptItems,
} from "../budget-query-types";

/** True only when A and B are mutually assignable, so neither side may drift. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const assertExact = <A, B>(_proof: Exact<A, B>) => {};

const transactionType = z.enum(["INCOME", "EXPENSE"]);

// --- get_spending_by_category ---

const categorySpending = z.object({
  categoryId: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  amount: z.number(),
  percentage: z.number(),
});
assertExact<z.infer<typeof categorySpending>, CategorySpending>(true);

export const spendingByCategoryOutput = { categories: z.array(categorySpending) };

// --- get_top_expenses ---

const topExpense = z.object({
  id: z.string(),
  amount: z.number(),
  description: z.string(),
  date: z.string(),
  categoryName: z.string(),
  categoryIcon: z.string(),
});
assertExact<z.infer<typeof topExpense>, TopExpense>(true);

export const topExpensesOutput = { expenses: z.array(topExpense) };

// --- get_monthly_summary ---

const monthSummary = z.object({
  month: z.string(),
  income: z.number(),
  expenses: z.number(),
  net: z.number(),
});
assertExact<z.infer<typeof monthSummary>, MonthSummary>(true);

export const monthlySummaryOutput = { months: z.array(monthSummary) };

// --- get_spending_trends ---

const spendingTrends = z.object({
  currentTotal: z.number(),
  previousTotal: z.number(),
  totalChange: z.number(),
  totalChangePercent: z.number().nullable(),
  byCategory: z.array(
    z.object({
      name: z.string(),
      current: z.number(),
      previous: z.number(),
      change: z.number(),
      changePercent: z.number().nullable(),
    })
  ),
});
assertExact<z.infer<typeof spendingTrends>, SpendingTrends>(true);

export const spendingTrendsOutput = spendingTrends.shape;

// --- search_transactions ---

const searchTransactions = z.object({
  transactions: z.array(
    z.object({
      id: z.string(),
      amount: z.number(),
      description: z.string(),
      type: transactionType,
      date: z.string(),
      categoryName: z.string(),
      categoryIcon: z.string(),
      categoryColor: z.string(),
      labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
    })
  ),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});
assertExact<z.infer<typeof searchTransactions>, SearchTransactionsResult>(true);

export const searchTransactionsOutput = searchTransactions.shape;

// --- get_budget_overview ---

const budgetOverview = z.object({
  month: z.string(),
  totalIncome: z.number(),
  totalExpenses: z.number(),
  net: z.number(),
  runningBalance: z.number(),
  transactionCount: z.number(),
});
assertExact<z.infer<typeof budgetOverview>, BudgetOverview>(true);

export const budgetOverviewOutput = budgetOverview.shape;

// --- get_upcoming_bills ---

const upcomingBills = z.object({
  count: z.number(),
  totalAmount: z.number(),
  bills: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      categoryName: z.string(),
      categoryIcon: z.string(),
      categoryColor: z.string(),
      amount: z.number(),
      dueDate: z.string(),
      isOverdue: z.boolean(),
    })
  ),
});
assertExact<z.infer<typeof upcomingBills>, UpcomingBillsResult>(true);

export const upcomingBillsOutput = upcomingBills.shape;

// --- get_category_list ---

const categoryItem = z.object({
  id: z.string(),
  name: z.string(),
  type: transactionType,
  icon: z.string(),
  color: z.string(),
  isDefault: z.boolean(),
});
assertExact<z.infer<typeof categoryItem>, CategoryItem>(true);

export const categoryListOutput = { categories: z.array(categoryItem) };

// --- get_label_breakdown ---

const labelBreakdown = z.object({
  month: z.string(),
  type: transactionType,
  total: z.number(),
  labels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
      amount: z.number(),
      percentage: z.number(),
      transactionCount: z.number(),
    })
  ),
});
assertExact<z.infer<typeof labelBreakdown>, LabelBreakdown>(true);

export const labelBreakdownOutput = labelBreakdown.shape;

// --- get_label_list ---

const labelItem = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  applicableTo: z.string(),
  transactionCount: z.number(),
  schedules: z.array(
    z.object({
      days: z.array(z.number()),
      startTime: z.string(),
      endTime: z.string(),
    })
  ),
});
assertExact<z.infer<typeof labelItem>, LabelItem>(true);

export const labelListOutput = { labels: z.array(labelItem) };

// --- get_bill_history ---

const billHistory = z.object({
  from: z.string(),
  to: z.string(),
  occurrences: z.array(
    z.object({
      billId: z.string(),
      billDescription: z.string(),
      categoryName: z.string(),
      amount: z.number(),
      paidAmount: z.number().nullable(),
      dueDate: z.string(),
      status: z.enum(["PAID", "SKIPPED", "SNOOZED"]),
      actionDate: z.string().nullable(),
      daysLate: z.number().nullable(),
      snoozeCount: z.number(),
      transactionId: z.string().nullable(),
      snoozeUntil: z.string().nullable(),
    })
  ),
  summaries: z.array(
    z.object({
      billId: z.string(),
      description: z.string(),
      categoryName: z.string(),
      occurrences: z.number(),
      paid: z.number(),
      skipped: z.number(),
      snoozed: z.number(),
      totalSnoozes: z.number(),
      paidOnTime: z.number(),
      paidLate: z.number(),
      avgDaysLate: z.number().nullable(),
      maxDaysLate: z.number().nullable(),
    })
  ),
});
assertExact<z.infer<typeof billHistory>, BillHistory>(true);

export const billHistoryOutput = billHistory.shape;

// --- get_receipt_items ---

const receiptItems = z.object({
  month: z.string().nullable(),
  itemCount: z.number(),
  totalAmount: z.number(),
  items: z.array(
    z.object({
      name: z.string(),
      amount: z.number(),
      transactionId: z.string(),
      transactionDescription: z.string(),
      transactionAmount: z.number(),
      categoryName: z.string(),
      date: z.string(),
      receiptGroupId: z.string().nullable(),
      breakdownTotal: z.number(),
    })
  ),
});
assertExact<z.infer<typeof receiptItems>, ReceiptItems>(true);

export const receiptItemsOutput = receiptItems.shape;

// --- create_transactions ---

/**
 * The write tool's result, deliberately narrower than the row the service returns.
 *
 * There is no query-layer type to pin this to with `assertExact`, because this shape is composed
 * here rather than mirrored from `budget-query-types.ts`. It stays hand-maintained on purpose:
 * echoing the full Prisma row would put `userId`, `mcpTokenId` and the raw receipt breakdown into
 * a tool result the model reads back, none of which it needs to confirm a write.
 */
const createdTransaction = z.object({
  id: z.string(),
  amount: z.number(),
  description: z.string(),
  type: transactionType,
  date: z.string(),
  categoryName: z.string(),
  labels: z.array(z.string()),
});

export const createTransactionsOutput = {
  /** Rows actually written. Zero on a replay, which created nothing. */
  created: z.number(),
  /** True when this `clientBatchId` had already been saved, so the rows below are the originals. */
  replayed: z.boolean(),
  transactions: z.array(createdTransaction),
};
