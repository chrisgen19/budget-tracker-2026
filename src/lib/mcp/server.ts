import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
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
  labelBreakdownOutput,
  labelListOutput,
  billHistoryOutput,
  receiptItemsOutput,
  createTransactionsOutput,
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
}: BudgetMcpServerOptions): McpServer => {
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
      description: "Get spending grouped by category for a given month. Returns expense categories sorted by amount with percentages.",
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe("Month in YYYY-MM format. Defaults to current month."),
      },
      outputSchema: spendingByCategoryOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ month }) => {
      const result = await getSpendingByCategory(prisma, userId, { month, timezoneOffset });
      const payload = { categories: result };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
  );

  registered.get_top_expenses = server.registerTool(
    "get_top_expenses",
    {
      title: "Top expenses",
      description: "Get the largest individual expense transactions, optionally filtered by month.",
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
          .describe("Month in YYYY-MM format. If omitted, returns all-time."),
      },
      outputSchema: topExpensesOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ limit, month }) => {
      const result = await getTopExpenses(prisma, userId, { limit, month, timezoneOffset });
      const payload = { expenses: result };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
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
      description: "Search and filter transactions by description, category, amount range, type, and month. Supports pagination and sorting.",
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
          .enum(["APP", "MCP"])
          .optional()
          .describe(
            "Where the row was created: APP for the app itself, MCP for rows written through this endpoint. Use it to review what you added."
          ),
      },
      outputSchema: searchTransactionsOutput,
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      const result = await searchTransactions(prisma, userId, { ...params, timezoneOffset });
      const payload = result;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
  );

  registered.get_budget_overview = server.registerTool(
    "get_budget_overview",
    {
      title: "Budget overview",
      description: "Get a high-level monthly summary: total income, expenses, net, running balance, and transaction count.",
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe("Month in YYYY-MM format. Defaults to current month."),
      },
      outputSchema: budgetOverviewOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ month }) => {
      const result = await getBudgetOverview(prisma, userId, { month, timezoneOffset });
      const payload = result;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
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
          .describe("Month in YYYY-MM format. Defaults to current month."),
        type: z
          .enum(["INCOME", "EXPENSE"])
          .optional()
          .describe("Transaction type to break down. Defaults to EXPENSE."),
      },
      outputSchema: labelBreakdownOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ month, type }) => {
      const result = await getLabelBreakdown(prisma, userId, {
        month,
        type,
        timezoneOffset,
      });
      const payload = result;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: structured(payload),
      };
    }
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
        "Filter by month, by item name, or by receiptGroupId to pull one whole receipt " +
        "(a receipt spanning several categories becomes several transactions sharing that id).",
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional()
          .describe("Month in YYYY-MM format. Omit for all time."),
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
          .max(500)
          .optional()
          .describe("Max items returned. Counts and totals cover every match. Defaults to 100."),
      },
      outputSchema: receiptItemsOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ month, search, receiptGroupId, limit }) => {
      const result = await getReceiptItems(prisma, userId, {
        month,
        search,
        receiptGroupId,
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
        "user's own is rejected. Scheduled labels are never applied automatically here, so pass " +
        "labelIds explicitly if the user wants any. `clientBatchId` must be a UUID you generate " +
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
                .describe("Label IDs from get_label_list. Omit or pass [] for none."),
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
          // Normalised to an explicit opt-out, never left undefined. `createTransactionBatch`
          // reads undefined as "auto-apply a scheduled label", and schedules match on time of
          // day and weekday, which describe when the user spent rather than when a model typed
          // it in. Leaving it undefined would silently tag rows the tool promises it never tags.
          labelIds: t.labelIds ?? [],
        })),
        clientBatchId: key.data,
        createdVia: "MCP",
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
        const message =
          result.reason === "LABELS_NOT_OWNED"
            ? "One or more label IDs are not this user's. Call get_label_list for valid IDs."
            : result.reason === "CATEGORIES_NOT_OWNED"
              ? "One or more category IDs are not this user's. Call get_category_list for valid IDs."
              : "Could not confirm whether these transactions were saved. Do NOT retry with a new clientBatchId: retry with the same one, which will return the original rows if they were written.";
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
