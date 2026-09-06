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
import type { ResolvedPeriod, TransactionTotals } from "../budget-query-types";
import type { ScanResultPayload } from "../receipt-scan";

/**
 * True only when A and B have exactly the same keys *and* are mutually assignable.
 *
 * The key comparison is not redundant. Mutual assignability alone does not catch an added
 * **optional** property: `{a: string}` and `{a: string; b?: string}` each extend the other, since
 * excess properties are permitted outside object literals. That is precisely the shape every
 * field added to a tool payload has taken — `breakdownDropped?`, `repairedFromYear?` — so the
 * assignability check alone passed while the schema silently fell behind the type it pins, which
 * is the drift this whole mechanism exists to prevent.
 *
 * Every check is tuple-wrapped and inlined rather than composed out of a named helper. A helper
 * returning `never` cannot be tested with `Helper<A, B> extends true`, because `never` is
 * assignable to everything and so takes the *true* branch — a guard written that way silently
 * passes on exactly the drift it was added to catch.
 */
type Exact<A, B> = [Exclude<keyof A, keyof B>] extends [never]
  ? [Exclude<keyof B, keyof A>] extends [never]
    ? [A] extends [B]
      ? [B] extends [A]
        ? true
        : never
      : never
    : never
  : never;
const assertExact = <A, B>(_proof: Exact<A, B>) => {};

const transactionType = z.enum(["INCOME", "EXPENSE"]);

/** The window a query actually ran over, in the user's own calendar days. */
const resolvedPeriod = z.object({
  month: z.string().nullable().describe("The month covered, or null for an explicit day range."),
  from: z.string().nullable().describe("First local day included, YYYY-MM-DD."),
  to: z.string().nullable().describe("Last local day included, YYYY-MM-DD, inclusive."),
});
assertExact<z.infer<typeof resolvedPeriod>, ResolvedPeriod>(true);

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

export const spendingByCategoryOutput = {
  categories: z.array(categorySpending),
  period: resolvedPeriod,
};

// --- get_top_expenses ---

const topExpense = z.object({
  id: z.string(),
  amount: z.number(),
  description: z.string(),
  date: z.string().describe("The stored instant, ISO 8601 in UTC."),
  localDate: z.string().describe("The user's own calendar day for that instant, YYYY-MM-DD."),
  categoryName: z.string(),
  categoryIcon: z.string(),
});
assertExact<z.infer<typeof topExpense>, TopExpense>(true);

export const topExpensesOutput = {
  expenses: z.array(topExpense),
  period: resolvedPeriod.nullable().describe("The window queried, or null for all time."),
};

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

const transactionTotals = z.object({
  count: z.number(),
  income: z.number(),
  expenses: z.number(),
  net: z.number(),
  byCategory: z.array(
    z.object({
      categoryId: z.string(),
      categoryName: z.string(),
      amount: z.number(),
      count: z.number(),
    })
  ),
});
assertExact<z.infer<typeof transactionTotals>, TransactionTotals>(true);

const searchTransactions = z.object({
  transactions: z.array(
    z.object({
      id: z.string(),
      amount: z.number(),
      description: z.string(),
      type: transactionType,
      date: z.string().describe("The stored instant, ISO 8601 in UTC."),
      localDate: z
        .string()
        .describe(
          "The same moment as the user's own calendar day, YYYY-MM-DD. Use this to group by " +
            "day, not a slice of `date`: east of UTC a late-evening transaction belongs to the " +
            "next local day than its UTC timestamp shows."
        ),
      categoryName: z.string(),
      categoryIcon: z.string().optional(),
      categoryColor: z.string().optional(),
      receiptGroupId: z
        .string()
        .nullable()
        .describe(
          "Rows sharing one of these came from a single scanned receipt split across " +
            "categories. Treat them as one purchase rather than several."
        ),
      labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
    })
  ),
  period: resolvedPeriod.nullable().describe("The window queried, or null when unfiltered."),
  totals: transactionTotals.describe(
    "Aggregates over every match, not just this page. Prefer these to summing `transactions`."
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
  month: z.string().nullable(),
  period: resolvedPeriod,
  today: z
    .string()
    .describe(
      "The user's current calendar day, YYYY-MM-DD. Anchor relative dates such as " +
        "\"this week\" to this rather than to the client's own clock."
    ),
  timezoneOffset: z
    .number()
    .describe("Minutes, getTimezoneOffset() convention: UTC+8 is -480."),
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
  totalIsEstimate: z
    .boolean()
    .describe(
      "True when any bill in the total had its amount derived rather than asserted, so the " +
        "total is an approximation."
    ),
  bills: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      categoryName: z.string(),
      categoryIcon: z.string(),
      categoryColor: z.string(),
      amount: z
        .number()
        .describe(
          "What the bill is expected to cost. For a fixed bill this is the amount set on it; " +
            "for a variable one it is derived from the payments already linked to it. Check " +
            "`isEstimate` before stating it as fact."
        ),
      isEstimate: z
        .boolean()
        .describe(
          "True when `amount` was derived from payment history rather than set on the bill. " +
            "Say \"about\" or \"roughly\" for such a figure: a metered bill can swing severalfold " +
            "across a year and the app cannot know what the next one will be."
        ),
      estimateBasis: z
        .enum(["same-month-last-year", "last-payment", "budgeted"])
        .nullable()
        .describe("How a derived amount was arrived at; null when `amount` was asserted."),
      dueDate: z.string().describe("The stored value as an ISO instant."),
      localDueDate: z
        .string()
        .describe(
          "The calendar day the bill falls due, YYYY-MM-DD. Report this rather than slicing " +
            "`dueDate`. It is deliberately NOT timezone-converted: a due date means \"the 5th\" " +
            "for everyone, and shifting one west of UTC would move it to the 4th and make an " +
            "on-time payment look late."
        ),
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
  month: z.string().nullable(),
  period: resolvedPeriod,
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
      dueDate: z.string().describe("The stored value as an ISO instant."),
      localDueDate: z
        .string()
        .describe("The calendar day the occurrence fell due, YYYY-MM-DD. Date-only, so not converted."),
      status: z.enum(["PAID", "SKIPPED", "SNOOZED"]),
      actionDate: z
        .string()
        .nullable()
        .describe(
          "When the occurrence was settled, as an ISO instant -- or, while it is still " +
            "outstanding, when it was most recently snoozed. Check `status` before calling it " +
            "a payment."
        ),
      localActionDate: z
        .string()
        .nullable()
        .describe(
          "The user's own calendar day for `actionDate`. Converted, unlike `localDueDate`, " +
            "because acting on a bill happens at a moment. It follows `actionDate` exactly, so " +
            "on a SNOOZED occurrence it is the snooze time, not a settlement."
        ),
      daysLate: z.number().nullable(),
      snoozeCount: z.number(),
      transactionId: z.string().nullable(),
      snoozeUntil: z.string().nullable(),
      localSnoozeUntil: z
        .string()
        .nullable()
        .describe(
          "The calendar day the snooze runs to, YYYY-MM-DD. Date-only and not converted, like " +
            "`localDueDate`: the snooze is stored as the user's own target day at UTC midnight."
        ),
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
  period: resolvedPeriod.nullable().describe("The window queried, or null when unfiltered."),
  itemCount: z.number(),
  totalAmount: z.number(),
  truncated: z
    .boolean()
    .describe(
      "True when `limit` cut the list short, so `items` is only the first part of what matched. " +
        "Read this rather than comparing `items.length` to `itemCount`. When true, re-request " +
        "with a higher `limit` before summarising, or say the list is partial."
    ),
  items: z.array(
    z.object({
      name: z.string(),
      amount: z.number(),
      transactionId: z.string(),
      transactionDescription: z.string(),
      transactionAmount: z.number(),
      categoryName: z.string(),
      date: z.string().describe("The transaction's stored instant, ISO 8601 in UTC."),
      localDate: z.string().describe("The user's own calendar day for that instant, YYYY-MM-DD."),
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

// --- update_transactions ---

/**
 * What one edited row looks like coming back.
 *
 * Carries the row as it now is *and* what it was, because an edit is the one write where the
 * result alone cannot be checked. A create that reports back what it wrote is self-evidently
 * right; an edit reporting `amount: 250` says nothing about whether it just replaced 2,500 with a
 * typo. `changed` and `previous` are what let the caller show the user the move rather than
 * assert the destination -- the same reason a repaired receipt year is stated in prose instead of
 * being applied silently.
 */
const updatedTransaction = z.object({
  id: z.string(),
  /** Only the fields whose stored value actually moved. Empty when the patch matched what was
   *  already there, which is a successful call that changed nothing. */
  changed: z
    .array(z.string())
    .describe(
      "Input field names that actually changed, e.g. `amount`, `categoryId`, `labelIds`. Empty " +
        "means the values sent already matched the stored ones, which is a success that changed " +
        "nothing."
    ),
  previous: z
    .object({
      amount: z.number().optional(),
      description: z.string().optional(),
      type: transactionType.optional(),
      /** The previous date, rendered the same way as `date` above so the two are comparable. */
      date: z.string().optional(),
      categoryName: z.string().optional(),
      labels: z.array(z.string()).optional(),
    })
    .describe(
      "The old values, for the fields named in `changed` only. Two keys are deliberately not " +
        "spelled the same as their `changed` entry, because an id is not worth showing anyone: " +
        "`categoryId` in `changed` appears here as `categoryName`, and `labelIds` as `labels`. " +
        "Do not index this object with a `changed` entry without translating those two."
    ),
  amount: z.number(),
  description: z.string(),
  type: transactionType,
  /**
   * The user's own calendar day as `YYYY-MM-DD`, not a UTC slice.
   *
   * When an edit moves the time *within* a single day, the day alone cannot show it, so a time is
   * appended at whatever precision distinguishes the two ends: `YYYY-MM-DD HH:mm`, or
   * `HH:mm:ss`, or `HH:mm:ss.mmm`. Treat this as display text, not as a value to send back --
   * `date` on the way in resolves seconds and milliseconds it was not given to zero, so echoing a
   * minute-precision rendering onto a row stored with seconds would quietly truncate them.
   */
  date: z.string(),
  categoryName: z.string(),
  labels: z.array(z.string()),
  /**
   * Consequences of the edit that are not visible in the row itself, for the caller to relay.
   *
   * Warnings rather than refusals: both cases are legitimate edits the app itself allows, and
   * blocking them would mean a bill payment logged at the wrong amount could never be corrected.
   * But neither is visible from the row, so an unwarned user finds out later from a report.
   */
  warnings: z.array(z.string()),
});

export const updateTransactionsOutput = {
  /** Rows whose stored values actually moved. Can be fewer than the patches sent. */
  updated: z.number(),
  transactions: z.array(updatedTransaction),
};

/**
 * What `scan_receipt` returns: a draft, never a saved row.
 *
 * `breakdown` stays opaque JSON — the caller either forwards it to `create_transactions`
 * unchanged or ignores it, and mirroring `receiptScanResultSchema` here would duplicate it for
 * no gain. The *field list*, though, is pinned to `ScanResultPayload` below, because the SDK
 * client validates `structuredContent` and rejects unknown properties: a field added to the
 * payload and not to this schema takes down `scan_receipt` for every remote client at runtime,
 * which is precisely what a leaked `dateSource` once did. This file previously declined the pin
 * on the grounds that it describes AI output; the shape is a repo-local interface, so it pins
 * exactly as the read schemas do.
 */
export const scanReceiptOutput = {
  amount: z.number(),
  categoryId: z.string(),
  /** YYYY-MM-DD in the user's own calendar. */
  date: z.string(),
  description: z.string(),
  type: z.literal("EXPENSE"),
  /**
   * True when the receipt spans more than one category.
   *
   * Carries `.describe()` rather than only this comment because JSDoc is erased at compile time:
   * the client is sent the serialized JSON Schema, so `describe` text is the sole channel that
   * reaches it. A caveat written here alone would be invisible to the audience that needs it.
   */
  multiCategory: z
    .boolean()
    .optional()
    .describe(
      "True when the receipt spans more than one category. This does NOT guarantee `breakdown` " +
        "is present: an itemization that fails validation is dropped so the rest of the scan " +
        "survives. Check `breakdown` itself, and never infer per-category splits from this flag."
    ),
  breakdown: z
    .unknown()
    .optional()
    .describe(
      "Per-category itemization, when one was produced. Absent on a single-category receipt and " +
        "also when `breakdownDropped` is true. Pass through to create_transactions unchanged."
    ),
  /** Set when an itemization was produced but rejected, so the caller knows one is missing rather
   *  than never having existed — and that rebuilding it costs another scan credit. */
  breakdownDropped: z
    .boolean()
    .optional()
    .describe(
      "True when the receipt was itemized but the itemization failed validation and was " +
        "discarded. The scan itself is valid and was charged; rebuilding the breakdown is a " +
        "separate, separately-metered call."
    ),
  /** Set when the scan replaced a misread year, naming the year the receipt appeared to print. */
  repairedFromYear: z
    .string()
    .optional()
    .describe(
      "The year originally read off the receipt, present only when the scan replaced it. The " +
        "year was overridden because it disagreed with the photo's while the month and day " +
        "matched exactly, which is a misread digit rather than an old receipt. Tell the user " +
        "the date was corrected and from what, so they can put it back if the receipt really " +
        "is from that year."
    ),
  /** The year read off the receipt does not match the current one, so the date is worth checking. */
  dateWarning: z.boolean(),
  /** The receipt's own date was unreadable, so the photo's date was used instead. */
  usedPhotoFallback: z.boolean(),
};
assertExact<z.infer<z.ZodObject<typeof scanReceiptOutput>>, ScanResultPayload>(true);
