import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TransactionSource } from "@prisma/client";
import {
  SCAN_FAILURE_MESSAGES,
  SCAN_REFUSAL_MESSAGES,
  WRITE_ERROR_MESSAGES,
} from "@/lib/mcp/write-errors";
import { z } from "zod";
import {
  MAX_BASE64_LENGTH,
  MAX_BREAKDOWN_GROUPS,
  MAX_BREAKDOWN_LINE_ITEMS,
  isBase64,
} from "@/lib/receipt-limits";
import {
  describePeriod,
  describePeriodOrCurrentMonth,
  getSpendingByCategory,
  getTopExpenses,
  getMonthlySummary,
  getSpendingTrends,
  searchTransactions,
  getBudgetOverview,
  getUpcomingBills,
  getCategoryList,
  getLabelBreakdown,
  getLabelList,
  getBillHistory,
  getReceiptItems,
} from "../budget-queries";
import { getAccountBalances } from "../account-balances";
import type { PrismaClient } from "../budget-query-types";
import { READ_ONLY_SCOPES, MCP_TOOL_SCOPES, type McpScope, type McpToolName } from "./scopes";
import { resolveWritePermission } from "./tokens";
import {
  createTransactionBatch,
  findSavedBatch,
  type TransactionWithRelations,
} from "../transaction-writes";
import {
  clientBatchIdSchema,
  formatLocalDate,
  hasTrustworthyTime,
  isRealDate,
  mcpTransactionSchema,
  resolveTransactionDate,
  MAX_BATCH_TRANSACTIONS,
} from "../validations";
import {
  spendingByCategoryOutput,
  topExpensesOutput,
  monthlySummaryOutput,
  spendingTrendsOutput,
  searchTransactionsOutput,
  budgetOverviewOutput,
  upcomingBillsOutput,
  categoryListOutput,
  accountBalancesOutput,
  labelBreakdownOutput,
  labelListOutput,
  billHistoryOutput,
  receiptItemsOutput,
  createTransactionsOutput,
  scanReceiptOutput,
} from "./output-schemas";

/**
 * Widen a typed result into the index-signature shape `structuredContent` requires.
 *
 * Interfaces get no implicit index signature, so `SpendingTrends` and friends are not
 * assignable to `Record<string, unknown>` directly. Spreading into a fresh object satisfies
 * that without an `as` cast, which would assert a shape rather than produce one.
 */
const structured = (value: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value));

const LOCAL_DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The `from`/`to` day bounds every period-taking tool offers alongside `month`.
 *
 * Declared once so the six tools cannot drift in what they accept or in how they describe it.
 * They are mutually exclusive with `month` rather than one silently winning: a filter that
 * applies half of what was asked returns rows that read exactly like a complete answer.
 */
const periodInput = {
  from: z
    .string()
    .regex(LOCAL_DAY_REGEX)
    .optional()
    .describe(
      "First day to include, YYYY-MM-DD in the user's own timezone. Cannot be combined with `month`."
    ),
  to: z
    .string()
    .regex(LOCAL_DAY_REGEX)
    .optional()
    .describe(
      "Last day to include, YYYY-MM-DD, inclusive of the whole day. Cannot be combined with `month`."
    ),
};

/**
 * Run a period-taking handler, turning an unusable window into an answer the model can act on.
 *
 * `resolvePeriod` throws a `RangeError` for a contradictory window (`month` with `from`), an
 * impossible day (31 February), or a backwards range. Left uncaught those surface as a
 * transport-level failure with no guidance, which a model retries unchanged; named back, it can
 * correct the call. Anything else still throws -- a bug should not be reported as bad input.
 */
const withPeriodErrors = async <T>(
  run: () => Promise<T>
): Promise<T | { content: Array<{ type: "text"; text: string }>; isError: true }> => {
  try {
    return await run();
  } catch (err) {
    if (err instanceof RangeError) {
      return { content: [{ type: "text" as const, text: err.message }], isError: true };
    }
    throw err;
  }
};

/**
 * Render a create result, shared by the write path and the lease-lapsed replay path so both
 * report the same shape. `created` is 0 on a replay: that request wrote nothing.
 */
const renderCreated = (
  transactions: TransactionWithRelations[],
  replayed: boolean,
  timezoneOffset: number
) => {
  const payload = {
    created: replayed ? 0 : transactions.length,
    replayed,
    transactions: transactions.map((t) => ({
      id: t.id,
      amount: t.amount,
      description: t.description,
      type: t.type,
      // The user's own calendar day, not a UTC slice: a UTC+8 user's 1 March row is stored as
      // 2026-02-28T16:00Z, so slicing the ISO string would echo back the wrong day for a
      // transaction the app correctly shows on the 1st.
      date: formatLocalDate(t.date, timezoneOffset),
      categoryName: t.category.name,
      labels: t.labels.map((l) => l.label.name),
    })),
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: structured(payload),
  };
};

export interface BudgetMcpServerOptions {
  /** Injected so the stdio entry point and the HTTP route can each supply their own client. */
  prisma: PrismaClient;
  /** Whose budget the tools read. Every query is scoped to it; nothing here derives it from input. */
  userId: string;
  /** Minutes, `getTimezoneOffset()` convention (UTC+8 is -480). Resolved by the caller from the
   *  user row, so month boundaries match what the user sees in the app. */
  timezoneOffset: number;
  /** Subject areas this caller may use. Tools outside them are removed before the server is
   *  served. Defaults to every *read* scope, never write: the stdio entry point does not pass
   *  this, and it supplies no lease, so defaulting to write would advertise a tool that is
   *  guaranteed to fail and point the user at a remote setting that does not apply to it. */
  scopes?: readonly McpScope[];
  /** `users.mcp_writes_enabled_until`, the write kill switch. Null or past means writes are
   *  refused even when the scope is granted. The stdio entry point passes null: a locally
   *  spawned server has no remote credential to contain, and writes are not offered there. */
  writesEnabledUntil?: Date | null;
  /** Recorded on every row this server writes, so an incident traces to one credential. */
  tokenId?: string;
  /**
   * Stamped onto rows this server writes, taken from the token row.
   *
   * Provenance belongs to the credential rather than the endpoint: every remote write arrives
   * here, so deriving it from the endpoint made a Telegram bot's rows claim Claude wrote them.
   * Never accepted from tool input, which would let a caller forge it.
   */
  createdVia?: TransactionSource;
}

/**
 * Build a fully registered read-only MCP server over one user's budget.
 *
 * Returns a new instance per call rather than a shared singleton: the HTTP transport runs
 * stateless, constructing a server per request, and a singleton would leak one request's
 * transport into the next. The stdio entry point calls this once and keeps the result.
 */
export const createBudgetMcpServer = ({
  prisma,
  userId,
  timezoneOffset,
  scopes = READ_ONLY_SCOPES,
  writesEnabledUntil = null,
  tokenId,
  createdVia = "MCP",
}: BudgetMcpServerOptions): McpServer => {
  // Scanning is gated by scope alone. It writes nothing, so the write lease does not apply; its
  // own limit is the user's monthly scan allowance, enforced inside `scanReceipt`.
  const scanEnabled = scopes.includes("receipts:scan");
  const registered = {} as Record<McpToolName, RegisteredTool>;

  const server = new McpServer(
    {
      name: "budgettracker",
      version: "1.0.0",
    },
    {
      instructions:
        "Read-only access to one person's personal budget: transactions, categories, " +
        "recurring bills, and monthly summaries. Use it for questions about their own " +
        "spending, income, or upcoming bills. Months are YYYY-MM and are resolved in the " +
        "user's own timezone, so results match what they see in the app. Amounts are plain " +
        "numbers in the user's configured currency. Every tool whose name begins with `get_` " +
        "or `search_` is read-only. `create_transactions`, when present, is the only tool that " +
        "writes, and nothing here can ever change or delete existing data.",
    }
  );

  // --- Tool registrations ---

  registered.get_spending_by_category = server.registerTool(
    "get_spending_by_category",
    {
      title: "Spending by category",
      description:
        "Get spending grouped by category over a month or an explicit day range. Returns expense " +
        "categories sorted by amount with percentages. `period` reports the window actually used.",
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe("Month in YYYY-MM format. Defaults to the current month."),
        ...periodInput,
      },
      outputSchema: spendingByCategoryOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ month, from, to }) =>
      withPeriodErrors(async () => {
        // Resolved once, before the query, and then handed to it. Resolving the current-month
        // default a second time after the await let a request in flight across local midnight
        // return one month's categories under the next month's name.
        const period = describePeriodOrCurrentMonth({ month, from, to }, timezoneOffset);
        const window = period.month
          ? { month: period.month }
          : { ...(period.from && { from: period.from }), ...(period.to && { to: period.to }) };
        const payload = {
          categories: await getSpendingByCategory(prisma, userId, { ...window, timezoneOffset }),
          period,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          structuredContent: structured(payload),
        };
      })
  );

  registered.get_top_expenses = server.registerTool(
    "get_top_expenses",
    {
      title: "Top expenses",
      description:
        "Get the largest individual expense transactions, optionally within a month or an " +
        "explicit day range. Each row carries `localDate`, the user's own calendar day.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Number of results. Defaults to 10."),
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe("Month in YYYY-MM format. If omitted, covers all time."),
        ...periodInput,
      },
      outputSchema: topExpensesOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ limit, month, from, to }) =>
      withPeriodErrors(async () => {
        const params = { month, from, to, timezoneOffset };
        const payload = {
          expenses: await getTopExpenses(prisma, userId, { ...params, limit }),
          period: describePeriod(params, timezoneOffset),
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          structuredContent: structured(payload),
        };
      })
  );

  registered.get_monthly_summary = server.registerTool(
    "get_monthly_summary",
    {
      title: "Monthly summary",
      description: "Get income, expenses, and net for each of the last N months. Good for trend analysis.",
      inputSchema: {
        months: z
          .number()
          .int()
          .min(1)
          .max(24)
          .optional()
          .describe("Number of months to look back. Defaults to 6."),
      },
      outputSchema: monthlySummaryOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ months }) => {
      const result = await getMonthlySummary(prisma, userId, { months, timezoneOffset });
      const payload = { months: result };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
  );

  registered.get_spending_trends = server.registerTool(
    "get_spending_trends",
    {
      title: "Spending trends",
      description: "Compare spending between two months, broken down by category. Shows which categories increased or decreased.",
      inputSchema: {
        currentMonth: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .describe("Current period in YYYY-MM format."),
        previousMonth: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .describe("Comparison period in YYYY-MM format."),
      },
      outputSchema: spendingTrendsOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ currentMonth, previousMonth }) => {
      const result = await getSpendingTrends(prisma, userId, {
        currentMonth,
        previousMonth,
        timezoneOffset,
      });
      const payload = result;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
  );

  registered.search_transactions = server.registerTool(
    "search_transactions",
    {
      title: "Search transactions",
      description:
        "Search and filter transactions by description, category, amount range, type, and either " +
        "a month or an explicit day range. Supports pagination and sorting. `totals` aggregates " +
        "every match rather than the page, so use it instead of summing rows; each row's " +
        "`localDate` is the user's own calendar day, and rows sharing a `receiptGroupId` are one " +
        "receipt split across categories.",
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe("Search term for transaction description (case-insensitive)."),
        type: z
          .enum(["INCOME", "EXPENSE"])
          .optional()
          .describe("Filter by transaction type."),
        categoryId: z
          .string()
          .optional()
          .describe("Filter by category ID. Use get_category_list to find IDs."),
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe("Filter by month in YYYY-MM format."),
        ...periodInput,
        amountMin: z.number().optional().describe("Minimum amount filter."),
        amountMax: z.number().optional().describe("Maximum amount filter."),
        sortBy: z
          .enum(["date", "amount"])
          .optional()
          .describe("Sort field. Defaults to date."),
        sortDir: z
          .enum(["asc", "desc"])
          .optional()
          .describe("Sort direction. Defaults to desc."),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Page number. Defaults to 1."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Results per page. Defaults to 20."),
        labelIds: z
          .array(z.string())
          .optional()
          .describe(
            "Only transactions carrying at least one of these label IDs. Use get_label_list to find IDs."
          ),
        createdVia: z
          .enum(["APP", "MCP", "TELEGRAM"])
          .optional()
          .describe(
            "Where the row was created: APP for the app itself, MCP for rows an assistant wrote " +
              "through this endpoint, TELEGRAM for rows the user's Telegram bot wrote. Use it to " +
              "review what you added."
          ),
        compact: z
          .boolean()
          .optional()
          .describe(
            "Omit each row's categoryIcon and categoryColor. They exist for the app's UI, no " +
              "analysis reads them, and they are roughly a fifth of a page's bytes."
          ),
      },
      outputSchema: searchTransactionsOutput,
      annotations: { readOnlyHint: true },
    },
    async (params) =>
      withPeriodErrors(async () => {
        const payload = await searchTransactions(prisma, userId, { ...params, timezoneOffset });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          structuredContent: structured(payload),
        };
      })
  );

  registered.get_budget_overview = server.registerTool(
    "get_budget_overview",
    {
      title: "Budget overview",
      description:
        "Get a high-level summary for a month or an explicit day range: total income, expenses, " +
        "net, running balance, and transaction count. Also reports `today` and `timezoneOffset`, " +
        "so call this first to anchor any relative period (\"this week\", \"yesterday\") to the " +
        "user's own calendar rather than to your clock or to UTC.",
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe("Month in YYYY-MM format. Defaults to the current month."),
        ...periodInput,
      },
      outputSchema: budgetOverviewOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ month, from, to }) =>
      withPeriodErrors(async () => {
        const payload = await getBudgetOverview(prisma, userId, {
          month,
          from,
          to,
          timezoneOffset,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          structuredContent: structured(payload),
        };
      })
  );

  registered.get_upcoming_bills = server.registerTool(
    "get_upcoming_bills",
    {
      title: "Upcoming bills",
      description: "Get scheduled transactions (bills) due within N days. Shows overdue bills too.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("Number of days to look ahead. Defaults to 7."),
      },
      outputSchema: upcomingBillsOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ days }) => {
      const result = await getUpcomingBills(prisma, userId, { days, timezoneOffset });
      const payload = result;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
  );

  registered.get_category_list = server.registerTool(
    "get_category_list",
    {
      title: "Category list",
      description: "List all budget categories (both default and custom). Useful for finding category IDs to use with other tools.",
      inputSchema: {
        type: z
          .enum(["INCOME", "EXPENSE"])
          .optional()
          .describe("Filter by category type."),
      },
      outputSchema: categoryListOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ type }) => {
      const result = await getCategoryList(prisma, userId, { type });
      const payload = { categories: result };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
  );

  registered.get_account_balances = server.registerTool(
    "get_account_balances",
    {
      title: "Account balances",
      description:
        "List the user's accounts (cash, bank, credit card, e-wallet) with the balance derived " +
        "from their transactions. Balances are signed: positive is money held, negative is money " +
        "owed, so a credit card normally reads negative and its `outstanding` field is what is " +
        "owed on it. Use this to find account IDs for create_transactions, and note that a " +
        "transfer between two accounts is not spending and never appears in any category total.",
      inputSchema: {
        includeInactive: z
          .boolean()
          .optional()
          .describe("Include archived accounts. Archived accounts cannot receive new transactions."),
        asOf: z
          .string()
          .regex(LOCAL_DAY_REGEX, "asOf must be a local day, YYYY-MM-DD")
          .optional()
          .describe(
            "Balances as at the end of this local day, inclusive. Omit for balances right now."
          ),
      },
      outputSchema: accountBalancesOutput,
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      const result = await getAccountBalances(prisma, userId, { ...params, timezoneOffset });
      const payload = { accounts: result };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
  );

  registered.get_label_breakdown = server.registerTool(
    "get_label_breakdown",
    {
      title: "Spending by label",
      description:
        "Get spending (or income) grouped by label for a month, with an 'unlabeled' entry for " +
        "untagged transactions. A transaction tagged with several labels splits its amount " +
        "evenly between them, so label amounts sum to the period total. Matches the app's " +
        "analytics page.",
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe("Month in YYYY-MM format. Defaults to the current month."),
        ...periodInput,
        type: z
          .enum(["INCOME", "EXPENSE"])
          .optional()
          .describe("Transaction type to break down. Defaults to EXPENSE."),
      },
      outputSchema: labelBreakdownOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ month, from, to, type }) =>
      withPeriodErrors(async () => {
        const payload = await getLabelBreakdown(prisma, userId, {
          month,
          from,
          to,
          type,
          timezoneOffset,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          structuredContent: structured(payload),
        };
      })
  );

  registered.get_label_list = server.registerTool(
    "get_label_list",
    {
      title: "Label list",
      description:
        "List the user's labels with how many transactions carry each, which transaction types " +
        "they apply to, and any schedules that auto-apply them. Useful for finding label IDs to " +
        "use with other tools.",
      inputSchema: {
        applicableTo: z
          .enum(["INCOME", "EXPENSE"])
          .optional()
          .describe(
            "Only labels usable on this transaction type. Labels marked BOTH always match."
          ),
      },
      outputSchema: labelListOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ applicableTo }) => {
      const result = await getLabelList(prisma, userId, { applicableTo });
      const payload = { labels: result };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
  );

  registered.get_bill_history = server.registerTool(
    "get_bill_history",
    {
      title: "Bill payment history",
      description:
        "Get what actually happened to past bill occurrences (paid, skipped, or snoozed), plus " +
        "a per-bill summary of payment patterns: how often each was paid late, the average and " +
        "worst lateness in days. Answers questions like 'how often do I pay rent late?' or " +
        "'which bills do I keep skipping?'. Negative lateness means paid early. Called without " +
        "a billId it covers every bill, so it can also be used to discover bill IDs.",
      inputSchema: {
        billId: z
          .string()
          .optional()
          .describe("Restrict to one bill. Omit to cover every bill."),
        status: z
          .enum(["PAID", "SKIPPED", "SNOOZED"])
          .optional()
          .describe("Restrict to one outcome."),
        months: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe("How many months back to look. Defaults to 6."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max occurrences returned. Summaries still cover the whole window. Defaults to 50."),
      },
      outputSchema: billHistoryOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ billId, status, months, limit }) => {
      const result = await getBillHistory(prisma, userId, {
        billId,
        status,
        months,
        limit,
        timezoneOffset,
      });
      const payload = result;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
  );

  registered.get_receipt_items = server.registerTool(
    "get_receipt_items",
    {
      title: "Receipt line items",
      description:
        "Get individual line items from scanned receipts, with the transaction and category " +
        "each was itemized under. Answers what was actually bought, not just the total: " +
        "'what did I buy at the grocery?', 'how much have I spent on coffee this month?'. " +
        "Filter by month, by an explicit day range, by item name, or by receiptGroupId to pull " +
        "one whole receipt (a receipt spanning several categories becomes several transactions " +
        "sharing that id).",
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe("Month in YYYY-MM format. Omit for all time."),
        ...periodInput,
        search: z
          .string()
          .optional()
          .describe("Case-insensitive substring match on the item name."),
        receiptGroupId: z
          .string()
          .optional()
          .describe("Restrict to one scanned receipt. IDs come back on each item."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_BREAKDOWN_LINE_ITEMS * MAX_BREAKDOWN_GROUPS)
          .optional()
          .describe(
            "Max items returned. Defaults to one transaction's worth, or a whole receipt's worth " +
              "when receiptGroupId is set — one receiptGroupId can span several transactions. " +
              "`itemCount` and `totalAmount` always cover every match, and the `truncated` flag " +
              "in the result says whether `items` is the complete list."
          ),
      },
      outputSchema: receiptItemsOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ month, from, to, search, receiptGroupId, limit }) =>
      withPeriodErrors(async () => {
        const payload = await getReceiptItems(prisma, userId, {
          month,
          from,
          to,
          search,
          receiptGroupId,
          limit,
          timezoneOffset,
        });
        return {
          // Not pretty-printed, unlike the other tools. This is the only result whose size scales
          // with a stored blob rather than a row count: raising the item bound made a full-ceiling
          // response MAX_BREAKDOWN_GROUPS x MAX_BREAKDOWN_LINE_ITEMS items, and every result is
          // already serialized twice — once here and once as structuredContent. Indentation on a
          // list that size is pure context spend, and `content` is only the fallback channel for
          // clients that do not read structuredContent.
          content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          structuredContent: structured(payload),
        };
      })
  );

  registered.scan_receipt = server.registerTool(
    "scan_receipt",
    {
      title: "Scan a receipt photo",
      description:
        "Read a photo of a receipt and return the amount, date, category and merchant, WITHOUT " +
        "saving anything. Show the result to the user, let them correct it, then call " +
        "create_transactions to save it. " +
        "Only for callers that cannot read the image themselves: if you can see the image, read " +
        "it directly and call create_transactions, because every call here spends one of the " +
        "user's monthly scans. " +
        "Send the raw image as base64 with its mime type (JPEG, PNG, WebP, HEIC or HEIF). The " +
        "image must be 4 MB or smaller before encoding. " +
        "The returned categoryId is always one of the user's own. Check dateWarning and " +
        "usedPhotoFallback before saving: both mean the date is a guess worth confirming.",
      inputSchema: {
        imageBase64: z
          .string()
          .min(1)
          // Bounded on the *encoded* length, which is the only length available before decoding.
          // Without it an arbitrarily large string was parsed as JSON and then allocated again by
          // Buffer.from, so the 4 MB image limit was only enforced after both had happened.
          .max(MAX_BASE64_LENGTH)
          .describe("The receipt image, base64 encoded, with no data: URL prefix."),
        mimeType: z
          .enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])
          .describe("The image's mime type."),
        localDate: z
          .string()
          .optional()
          .describe(
            "Today's date in the user's timezone as YYYY-MM-DD. Used to spot a receipt year " +
              "that cannot be right. Defaults to the user's today."
          ),
        photoTakenAt: z
          .string()
          .optional()
          .describe(
            "When the photo was taken, if known, as an offset-less local timestamp such as " +
              "2026-08-01T20:05:04. Used only when the receipt's own date cannot be read, in " +
              "which case it is far better than today: a receipt photographed on Monday and " +
              "sent on Thursday belongs on Monday. Read it from the image's EXIF if you have it."
          ),
        caption: z
          .string()
          .max(1024)
          .optional()
          .describe(
            "Free text the user attached to the image, if any. Used as a hint for the category " +
              "and description; the receipt itself wins wherever the two disagree, and it never " +
              "affects the amount or the date. Send it verbatim rather than summarising it."
          ),
      },
      outputSchema: scanReceiptOutput,
      // Not read-only: each call spends a metered, paid resource, so clients must prompt rather
      // than auto-approving it. It still writes nothing, hence destructiveHint false. Not
      // idempotent either: a second call costs a second scan and Gemini may read it differently.
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ imageBase64, mimeType, localDate, photoTakenAt, caption }) => {
      const refuse = (text: string) => ({
        content: [{ type: "text" as const, text }],
        isError: true,
      });

      if (!scanEnabled) {
        return refuse(
          "This token cannot scan receipts. Mint a new token with the receipts:scan scope in Profile > MCP Access."
        );
      }

      // Checked on the string, not on what it decodes to. Buffer.from skips characters outside
      // the base64 alphabet instead of failing, so garbage decodes to a short run of nonsense
      // rather than to nothing, and a length check waves it through to Gemini at the cost of a
      // scan credit.
      if (!isBase64(imageBase64)) {
        return refuse("imageBase64 is not valid base64. Send the raw image bytes, base64 encoded, with no data: URL prefix.");
      }
      const buffer = Buffer.from(imageBase64, "base64");

      const today = formatLocalDate(new Date(), timezoneOffset);
      const todayStr = localDate && isRealDate(localDate) ? localDate.slice(0, 10) : today;
      // Validated the same way as any other caller-supplied date, so a malformed one is ignored
      // rather than propagated into a transaction.
      const capturedAt =
        photoTakenAt && isRealDate(photoTakenAt) && hasTrustworthyTime(photoTakenAt, timezoneOffset)
          ? photoTakenAt
          : null;

      // Imported here rather than at module scope on purpose: `receipt-scan` pulls in
      // `gemini.ts`, which builds its client on load and throws without GEMINI_API_KEY. At the
      // top of this file that would make the stdio entry point refuse to start on a machine that
      // has no Gemini key and never intended to scan anything.
      const { scanReceipt } = await import("@/lib/receipt-scan");

      const outcome = await scanReceipt({
        userId,
        mimeType,
        byteLength: buffer.length,
        // Already decoded above to measure it, and the schema caps the encoded string, so the
        // allocation here is bounded before this point rather than by the lazy read.
        readBase64: () => imageBase64,
        todayStr,
        // When the receipt's own date cannot be read, the photo's capture time is the best
        // remaining evidence of when the purchase happened. Today is only the fallback of last
        // resort, and it is wrong for any receipt photographed before it was sent.
        photoDateStr: capturedAt ? capturedAt.slice(0, 10) : todayStr,
        capturedAt,
        caption,
      });

      if ("refusal" in outcome) return refuse(SCAN_REFUSAL_MESSAGES[outcome.refusal.reason](outcome.refusal));
      if (!outcome.ok) return refuse(SCAN_FAILURE_MESSAGES[outcome.failure.reason]);

      const r = outcome.result;
      const summary =
        `Receipt read: ${r.description} for ${r.amount} on ${r.date}.` +
        (r.repairedFromYear
          ? // Named, not just flagged: the model is about to file this date, and a correction it
            // cannot see is one it cannot mention or undo.
            ` The year read off the receipt was ${r.repairedFromYear}, which disagreed with the` +
            " photo's while the month and day matched exactly, so it was corrected to the date" +
            " above. Tell the user, and put it back if they say the receipt really is that old."
          : r.dateWarning
            ? " The year on the receipt looks wrong, so confirm the date."
            : "") +
        (r.usedPhotoFallback
          ? // Which fallback was used is not cosmetic. A model that reads "today's was used"
            // while the structured date says a fortnight ago will offer to correct a date that
            // is already right. `scanReceipt` sets the date to `capturedAt` in exactly this
            // case, so comparing them reports what happened rather than guessing at it.
            capturedAt && r.date === capturedAt
            ? " The receipt's own date was unreadable, so the time the photo was taken was used instead. That is when the purchase happened, so do not offer to change it to today."
            : " The receipt's own date was unreadable, so today's was used. Ask the user whether that is right."
          : "") +
        (r.breakdownDropped
          ? // The prose channel is what many clients actually surface, so a caveat that lives
            // only in structuredContent is one the user never hears. Without this a model reads
            // a clean single-amount draft and files a multi-category receipt as one lumped row,
            // never knowing the per-category split existed.
            " This receipt covers more than one category, but its per-category itemization could" +
            " not be read and was discarded, so only the total is available here. Rebuilding it" +
            " is a separate scan that costs another scan credit."
          : "") +
        " Nothing has been saved. Confirm with the user, then call create_transactions.";

      return {
        content: [{ type: "text" as const, text: summary }],
        structuredContent: { ...r },
      };
    }
  );

  registered.create_transactions = server.registerTool(
    "create_transactions",
    {
      title: "Create transactions",
      description:
        "Create one or more transactions in a single write. Use it after agreeing the amounts, " +
        "dates and categories with the user, for example when entering a stack of receipts. " +
        "If the user says when something happened, put that in the date as a timestamp rather " +
        "than a bare date, or the time is lost. " +
        "Call get_category_list first to resolve category IDs; a category that is not the " +
        "user's own is rejected. Omitting labelIds lets the user's own auto-apply label schedules " +
        "decide, which is usually what they want; pass explicit ids to override them, or [] to " +
        "force no labels. Schedules are skipped for a backdated bare date, because the time on " +
        "one is filled in rather than known. `clientBatchId` must be a UUID you generate " +
        "once per intent and REUSE unchanged if a call fails and you retry: replaying the same " +
        "id returns the original rows instead of creating duplicates. Generate a fresh id only " +
        "for a genuinely new set of transactions.",
      inputSchema: {
        transactions: z
          .array(
            z.object({
              amount: z.number().positive().describe("Amount in the user's currency, always positive."),
              description: z.string().max(255).describe("What the transaction was for."),
              type: z.enum(["INCOME", "EXPENSE"]),
              date: z
                .string()
                .describe(
                  "When it happened, in the user's own timezone. INCLUDE THE TIME whenever the user " +
                    "indicates one, even loosely: 'last night' -> 2026-08-25T21:00, 'this morning' -> " +
                    "2026-08-26T08:30, 'at lunch' -> 2026-08-26T12:30. A bare date such as 2026-08-25 " +
                    "records no time and is filled in with the current clock, so any time the user " +
                    "mentioned is lost. Send a bare date only when they gave no indication at all."
                ),
              categoryId: z.string().describe("From get_category_list. Must be the user's own."),
              labelIds: z
                .array(z.string())
                .optional()
                .describe(
                  "Label IDs from get_label_list. Omit to let the user's own auto-apply schedules " +
                    "decide, which is usually what they want. Pass [] to force no labels."
                ),
            })
          )
          .min(1)
          .max(MAX_BATCH_TRANSACTIONS),
        clientBatchId: z
          .string()
          .uuid()
          .describe("A UUID identifying this intent. Reuse it verbatim when retrying a failure."),
      },
      outputSchema: createTransactionsOutput,
      // Deliberately no readOnlyHint, so clients prompt before each call rather than
      // auto-approving. Nothing here overwrites or removes existing rows, hence destructiveHint
      // false; replaying a clientBatchId returns the original rows, hence idempotentHint true.
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ transactions, clientBatchId }) => {
      const permission = resolveWritePermission(scopes, writesEnabledUntil);

      if (!permission.allowed) {
        // A batch that committed but whose response was lost must stay resolvable, and the
        // required retry carries the same key. If the lease lapsed in between, refusing that
        // retry leaves the caller unable to tell whether the rows exist, which is the state most
        // likely to end in a manual duplicate or a resubmit under a fresh key.
        //
        // Returning an already-committed batch writes nothing, so the kill switch loses nothing
        // by allowing it. Deliberately narrow: only a lapsed *lease* is bypassed, never a missing
        // scope (such a token could never have created the batch), the key must be well formed,
        // and this path can only ever read. A caller with no saved batch under that key still
        // falls through to the refusal below, so no write can happen while writes are off.
        const replayKey = clientBatchIdSchema.safeParse(clientBatchId);
        if (permission.reason === "WRITES_DISABLED" && replayKey.success) {
          const saved = await findSavedBatch(prisma, userId, replayKey.data);
          if (saved.length > 0) return renderCreated(saved, true, timezoneOffset);
        }

        const message =
          permission.reason === "SCOPE_NOT_GRANTED"
            ? "This token cannot create transactions. Mint a new token with the transactions:write scope in Profile > MCP Access."
            : "Writes are currently switched off for this account. Turn them on in Profile > MCP Access, then try again.";
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }

      const parsed = z.array(mcpTransactionSchema).safeParse(transactions);
      const key = clientBatchIdSchema.safeParse(clientBatchId);
      if (!parsed.success || !key.success) {
        // Named back to the model so it can correct the input rather than retry it unchanged.
        // An unparseable date used to reach Prisma and fail inside the transaction, which
        // surfaced as UNKNOWN_WHETHER_SAVED and told the model to retry a doomed request.
        const detail = parsed.success
          ? "clientBatchId must be a UUID."
          : parsed.error.issues
              .slice(0, 3)
              .map((i) => `transactions[${i.path.join(".")}]: ${i.message}`)
              .join(" ");
        return {
          content: [{ type: "text" as const, text: `Invalid transaction data. ${detail}` }],
          isError: true,
        };
      }

      const result = await createTransactionBatch({
        prisma,
        userId,
        items: parsed.data.map((t) => ({
          ...t,
          // A bare YYYY-MM-DD parses as midnight UTC, which is the previous day west of
          // Greenwich, so the row would land in the wrong month for those users. Resolved
          // against the user's own offset, matching every other write path in the app.
          date: resolveTransactionDate(t.date, timezoneOffset),
          // Labels the caller named are used as given. When none are named, schedules apply
          // only if the timestamp reflects reality: `undefined` lets `createTransactionBatch`
          // match them, `[]` opts out.
          //
          // The distinction matters because a bare date is filled with the current clock. That
          // is right for entering something as it happens and wrong for backdating, where
          // "yesterday's dinner" would carry this morning's time and land inside a weekday
          // 05:00-17:00 window, tagging a dinner as work spending on the user's busiest label.
          labelIds:
            t.labelIds ?? (hasTrustworthyTime(t.date, timezoneOffset) ? undefined : []),
        })),
        clientBatchId: key.data,
        createdVia,
        mcpTokenId: tokenId,
        // The lease was read when the request arrived; a batch can then hold a transaction for
        // up to a minute. Re-read at the moment of the write so "Turn off now" stops work that
        // is already in flight, rather than only refusing the next request.
        assertStillPermitted: async (tx) => {
          const current = await tx.user.findUnique({
            where: { id: userId },
            select: { mcpWritesEnabledUntil: true },
          });
          return resolveWritePermission(scopes, current?.mcpWritesEnabledUntil ?? null).allowed;
        },
      });

      if (!result.ok) {
        // One message per reason, from the shared table. NO_LONGER_PERMITTED used to fall into
        // the "could not confirm" wording, which was wrong: that check runs inside the
        // transaction before any row is created, so nothing was written and there is nothing
        // ambiguous to resolve.
        const message = WRITE_ERROR_MESSAGES[result.reason];
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }

      return renderCreated(result.transactions, result.replayed, timezoneOffset);
    }
  );

  // Registration above is unconditional so every tool keeps its inferred input/output types;
  // narrowing happens here, once, against one map. Anything not covered by a granted scope is
  // removed rather than left disabled, so `tools/list` never names it.
  for (const [name, tool] of Object.entries(registered) as [McpToolName, RegisteredTool][]) {
    if (!scopes.includes(MCP_TOOL_SCOPES[name])) tool.remove();
  }

  return server;
};
