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
import type {
  AssessmentAnomaly,
  AssessmentBillAccuracy,
  AssessmentBillFacts,
  AssessmentCategoryMovement,
  AssessmentDataConfidence,
  AssessmentDuplicateGroup,
  AssessmentFacts,
  AssessmentFragmentation,
  AssessmentHeadline,
  AssessmentHygieneFacts,
  AssessmentLoggingGap,
  AssessmentMissedBill,
  AssessmentMonthCoverage,
  AssessmentRecurringFacts,
  AssessmentRecurringItem,
  AssessmentTrendFacts,
  AssessmentUnlinkedBillPayment,
} from "@/types";

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
  isPartial: z
    .boolean()
    .describe(
      "True when this window is still running, so its figures are a running subtotal rather " +
        "than a result. Do not compare a partial window's totals with a finished period's " +
        "without saying so, and do not describe it as a complete month."
    ),
  daysInPeriod: z
    .number()
    .nullable()
    .describe("Calendar days the window spans. Null when either end is open."),
  daysElapsed: z
    .number()
    .nullable()
    .describe(
      "Days of the window that have actually happened. Null when the start is open. Use it " +
        "with daysInPeriod to say how far through a partial period the figures reach."
    ),
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
  month: z.string().describe('Display label, e.g. "Sep 2026".'),
  monthKey: z.string().describe("The same month as YYYY-MM, for querying other tools."),
  income: z.number(),
  expenses: z.number(),
  net: z.number(),
  isPartial: z
    .boolean()
    .describe(
      "True while the month is still running. A partial month's totals are NOT comparable " +
        "with the finished months beside them; say so rather than reporting a fall."
    ),
  daysInMonth: z.number(),
  daysElapsed: z.number().describe("Days of the month that have happened."),
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
  throughDay: z
    .number()
    .nullable()
    .describe(
      "The day of the month the comparison was cut off at, set whenever the current month is " +
        "still running. It is the cutoff asked for, not necessarily the last day of both " +
        "windows: a comparison month shorter than this day ends at its own month end instead " +
        "(cutoff 30 against February ends on the 28th). Read `currentPeriod` and " +
        "`previousPeriod` for the exact windows. When it is set the figures are not " +
        "whole-month totals, so say the comparison runs to that cutoff in each month."
    ),
  currentPeriod: resolvedPeriod.describe("The window currentTotal covers, after clipping."),
  previousPeriod: resolvedPeriod.describe("The window previousTotal covers, after clipping."),
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

// --- get_assessment_facts ---

/**
 * The deterministic half of the AI Assessment, pinned field for field to `AssessmentFacts`.
 *
 * Every one of these is a *measurement*, not an interpretation. That distinction is the reason
 * the module behind it exists: handed five totals, a model cannot see that July is missing fifteen
 * days of logging or that a bill has had no payment recorded since June, so it invents patterns
 * instead -- the one thing a report about money must not do. Exposing the measurements is what
 * lets a client on a phone answer "how am I doing?" with the same figures the app shows rather
 * than re-deriving them from raw aggregates and reproducing exactly that failure.
 *
 * Pinned with `assertExact` like every read schema here, and for a sharper reason than usual: the
 * type is nine nested structures deep, so a field added to one of them is precisely the drift
 * nobody would notice by eye.
 */
const monthCoverage = z.object({
  month: z.string(),
  label: z.string(),
  daysLogged: z.number(),
  daysInMonth: z.number(),
  coveragePct: z.number(),
  transactionCount: z.number(),
  income: z.number(),
  expenses: z.number(),
  status: z.enum(["ok", "low-coverage", "partial"]),
});
assertExact<z.infer<typeof monthCoverage>, AssessmentMonthCoverage>(true);

const loggingGap = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number(),
  inPeriod: z.boolean(),
});
assertExact<z.infer<typeof loggingGap>, AssessmentLoggingGap>(true);

const dataConfidence = z.object({
  months: z.array(monthCoverage),
  trustworthyMonths: z.array(z.string()),
  excludedMonths: z.array(z.string()),
  gaps: z.array(loggingGap),
  periodCoveragePct: z.number(),
  periodIsPartial: z.boolean(),
  periodDaysElapsed: z.number(),
  periodDaysTotal: z.number(),
});
assertExact<z.infer<typeof dataConfidence>, AssessmentDataConfidence>(true);

const billAccuracy = z.object({
  id: z.string(),
  description: z.string(),
  categoryName: z.string(),
  budgeted: z.number(),
  isVariable: z.boolean(),
  payments: z.number(),
  avgPaid: z.number().nullable(),
  lowest: z.number().nullable(),
  highest: z.number().nullable(),
  swing: z.number().nullable(),
  variancePct: z.number().nullable(),
  verdict: z.enum(["ok", "under-budgeted", "over-budgeted", "seasonal", "no-payments"]),
  monthlySeries: z.array(z.object({ month: z.string(), label: z.string(), amount: z.number() })),
});
assertExact<z.infer<typeof billAccuracy>, AssessmentBillAccuracy>(true);

const missedBill = z.object({
  id: z.string(),
  description: z.string(),
  categoryName: z.string(),
  amount: z.number(),
  isEstimate: z.boolean(),
  missedDueDates: z.array(z.string()),
  daysOverdue: z.number(),
  estimatedArrears: z.number(),
});
assertExact<z.infer<typeof missedBill>, AssessmentMissedBill>(true);

const unlinkedBillPayment = z.object({
  billId: z.string(),
  billDescription: z.string(),
  count: z.number(),
  total: z.number(),
  recentDates: z.array(z.string()),
});
assertExact<z.infer<typeof unlinkedBillPayment>, AssessmentUnlinkedBillPayment>(true);

const headline = z.object({
  months: z.number(),
  income: z.number(),
  expenses: z.number(),
  net: z.number(),
  savingsRatePct: z.number().nullable(),
  avgMonthlyBurn: z.number().nullable(),
  runningBalance: z.number().nullable(),
  monthsOfRunway: z.number().nullable(),
});
assertExact<z.infer<typeof headline>, AssessmentHeadline>(true);

const billFacts = z.object({
  asOf: z.string(),
  missed: z.array(missedBill),
  accuracy: z.array(billAccuracy),
  unlinkedPayments: z.array(unlinkedBillPayment),
  dueSoonCount: z.number(),
  dueSoonTotal: z.number(),
  dueSoonIsEstimate: z.boolean(),
});
assertExact<z.infer<typeof billFacts>, AssessmentBillFacts>(true);

const categoryMovement = z.object({
  category: z.string(),
  type: transactionType,
  current: z.number(),
  priorAvg: z.number(),
  changePct: z.number().nullable(),
  change: z.number(),
  direction: z.enum(["up", "down", "new"]),
  baselineMonths: z.number(),
});
assertExact<z.infer<typeof categoryMovement>, AssessmentCategoryMovement>(true);

const trendFacts = z.object({
  comparedMonth: z.string().nullable(),
  comparedMonthLabel: z.string().nullable(),
  baselineMonths: z.array(z.string()),
  movements: z.array(categoryMovement),
  monthlyNet: z.array(
    z.object({
      month: z.string(),
      label: z.string(),
      income: z.number(),
      expenses: z.number(),
      net: z.number(),
    })
  ),
  baselineSavingsRatePct: z.number().nullable(),
  avgMonthlyBurn: z.number().nullable(),
});
assertExact<z.infer<typeof trendFacts>, AssessmentTrendFacts>(true);

const recurringItem = z.object({
  description: z.string(),
  months: z.number(),
  occurrences: z.number(),
  avgAmount: z.number(),
  total: z.number(),
  isNew: z.boolean(),
  firstSeen: z.string(),
  lastSeen: z.string(),
});
assertExact<z.infer<typeof recurringItem>, AssessmentRecurringItem>(true);

const recurringFacts = z.object({
  items: z.array(recurringItem),
  newItems: z.array(recurringItem),
  monthlyBase: z.number(),
  monthlyBasePct: z.number().nullable(),
});
assertExact<z.infer<typeof recurringFacts>, AssessmentRecurringFacts>(true);

const duplicateGroup = z.object({
  date: z.string(),
  description: z.string(),
  amount: z.number(),
  copies: z.number(),
  inPeriod: z.boolean(),
});
assertExact<z.infer<typeof duplicateGroup>, AssessmentDuplicateGroup>(true);

const fragmentation = z.object({
  normalized: z.string(),
  variants: z.array(z.string()),
  transactions: z.number(),
});
assertExact<z.infer<typeof fragmentation>, AssessmentFragmentation>(true);

const hygieneFacts = z.object({
  duplicates: z.array(duplicateGroup),
  unlabeled: z.object({
    fromBills: z.object({ count: z.number(), total: z.number() }),
    manual: z.object({ count: z.number(), total: z.number() }),
    pctOfSpend: z.number(),
  }),
  fragmentation: z.array(fragmentation),
  incomeConcentrationPct: z.number().nullable(),
  topIncomeSource: z.string().nullable(),
  incomeSources: z.array(
    z.object({
      source: z.string(),
      count: z.number(),
      total: z.number(),
      pct: z.number().nullable(),
    })
  ),
});
assertExact<z.infer<typeof hygieneFacts>, AssessmentHygieneFacts>(true);

const anomaly = z.object({
  kind: z.enum([
    "category-spike",
    "new-category",
    "outlier-transaction",
    "overspend",
    "savings-drop",
    "pace",
    "missing-income",
    "duplicate",
    "logging-gap",
    "missed-bill",
  ]),
  title: z.string(),
  detail: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  current: z.number().nullable(),
  baseline: z.number().nullable(),
  changePct: z.number().nullable(),
});
assertExact<z.infer<typeof anomaly>, AssessmentAnomaly>(true);

export const assessmentFactsOutput = {
  generatedAt: z.string(),
  currency: z.string(),
  period: z.object({
    from: z.string(),
    to: z.string(),
    label: z.string(),
    granularity: z.string(),
  }),
  window: z.object({ from: z.string(), to: z.string(), months: z.number() }),
  confidence: dataConfidence,
  headline: headline,
  bills: billFacts,
  trends: trendFacts,
  recurring: recurringFacts,
  hygiene: hygieneFacts,
  anomalies: z.array(anomaly),
};
assertExact<z.infer<z.ZodObject<typeof assessmentFactsOutput>>, AssessmentFacts>(true);

// --- pay_bill ---

/**
 * What settling an occurrence reports back.
 *
 * Says what the schedule now points at rather than only "done", because advancing the cursor is
 * the half of this that `create_transactions` could never do and the half the caller cannot see
 * from a transaction id. `deactivated` is called out separately: a bill going quiet because its
 * schedule ran out looks identical to one going quiet because nothing is due, and only one of
 * those is worth telling the user about.
 */
export const payBillOutput = {
  billId: z.string(),
  action: z.enum(["pay", "pay_existing", "skip", "snooze"]),
  /** The transaction that settled it: created by `pay`, named by `pay_existing`, null otherwise. */
  transactionId: z.string().nullable(),
  /** What actually reached the ledger, so a variable bill's fallback figure is never a guess the
   *  caller has to make. Null when no money moved. */
  amountPaid: z.number().nullable(),
  /** The bill's next due date as a calendar day, YYYY-MM-DD. Null after a snooze, which defers the
   *  reminder without settling the occurrence, and null when the schedule has run out. */
  nextDueDate: z.string().nullable(),
  /** True when the walk found no further occurrence, so the bill was switched off. Reversible:
   *  `update_bill` with `isActive: true` brings it back. */
  deactivated: z.boolean(),
  /** For a snooze: the calendar day the reminder returns on, YYYY-MM-DD. */
  snoozeUntil: z.string().nullable(),
  /** Consequences the row itself does not show, for the caller to relay -- most importantly a
   *  payment linked from a different category than the bill's. */
  warnings: z.array(z.string()),
  /** True when the work was already done and this call wrote nothing: a retried snooze resolves to
   *  the deferral already in place rather than writing a second one. */
  replayed: z.boolean(),
};

// --- create_bill / update_bill ---

const billPayload = z.object({
  id: z.string(),
  description: z.string(),
  amount: z.number(),
  /** True when the amount varies month to month, so `amount` is only a forecasting fallback and
   *  `pay_bill` requires an explicit figure. */
  isVariable: z.boolean(),
  type: transactionType,
  categoryId: z.string(),
  categoryName: z.string(),
  frequency: z.string(),
  customIntervalDays: z.number().nullable(),
  reminderDaysBefore: z.number(),
  /** Calendar days, YYYY-MM-DD. Bill dates are date-only values and are never converted through a
   *  timezone: a due date of the 5th is the 5th for everyone. */
  startDate: z.string(),
  endDate: z.string().nullable(),
  nextDueDate: z.string(),
  isActive: z.boolean(),
  labels: z.array(z.string()),
});

/** A label the caller asked for and did not get, with the reason. Reported rather than dropped in
 *  silence: `changed` shows a label leaving but never why, and an unexplained disappearance reads
 *  as a bug in the tool. */
const droppedLabel = z.object({
  labelId: z.string(),
  name: z.string().nullable(),
  reason: z.literal("TYPE_MISMATCH"),
});

export const createBillOutput = {
  bill: billPayload,
  droppedLabels: z.array(droppedLabel),
};

export const updateBillOutput = {
  bill: billPayload,
  /** Only the fields whose stored value actually moved. Empty means the patch matched what was
   *  already there, which is a success that changed nothing. */
  changed: z.array(z.string()),
  droppedLabels: z.array(droppedLabel),
  /** Consequences not visible in the row itself, for the caller to relay -- a recalculated due
   *  date, or a bill switched off because its schedule ran out. */
  warnings: z.array(z.string()),
};

// --- create_label ---

export const createLabelOutput = {
  id: z.string(),
  name: z.string(),
  color: z.string(),
  applicableTo: z.enum(["EXPENSE", "INCOME", "BOTH"]),
  /** Auto-apply rules, if any were given. A schedule tags matching transactions at write time. */
  schedules: z.array(
    z.object({
      id: z.string(),
      days: z.array(z.number()),
      startTime: z.string(),
      endTime: z.string(),
    })
  ),
};
