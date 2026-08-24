import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PrismaClient } from "@prisma/client";
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
} from "../../src/lib/budget-queries.js";

const userId = process.env.BUDGET_USER_ID;

if (!userId) {
  console.error("BUDGET_USER_ID environment variable is required");
  process.exit(1);
}

const prisma = new PrismaClient();

/**
 * The user's timezone offset in minutes, read once at startup.
 *
 * Assigned in `main()` strictly before `server.connect()`, so no tool handler can observe
 * the initial value: a handler only runs in response to a request, and requests cannot
 * arrive until the transport is connected. Registering the tools inside `main()` instead
 * would enforce that structurally, at the cost of re-indenting every registration.
 */
let userTimezoneOffset = 0;

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
      "numbers in the user's configured currency. Every tool is read-only; nothing here " +
      "can create, change, or delete their data.",
  }
);

// --- Tool registrations ---

server.registerTool(
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
    annotations: { readOnlyHint: true },
  },
  async ({ month }) => {
    const result = await getSpendingByCategory(prisma, userId, { month, timezoneOffset: userTimezoneOffset });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
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
    annotations: { readOnlyHint: true },
  },
  async ({ limit, month }) => {
    const result = await getTopExpenses(prisma, userId, { limit, month, timezoneOffset: userTimezoneOffset });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
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
    annotations: { readOnlyHint: true },
  },
  async ({ months }) => {
    const result = await getMonthlySummary(prisma, userId, { months, timezoneOffset: userTimezoneOffset });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
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
    annotations: { readOnlyHint: true },
  },
  async ({ currentMonth, previousMonth }) => {
    const result = await getSpendingTrends(prisma, userId, {
      currentMonth,
      previousMonth,
      timezoneOffset: userTimezoneOffset,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
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
    },
    annotations: { readOnlyHint: true },
  },
  async (params) => {
    const result = await searchTransactions(prisma, userId, { ...params, timezoneOffset: userTimezoneOffset });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
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
    annotations: { readOnlyHint: true },
  },
  async ({ month }) => {
    const result = await getBudgetOverview(prisma, userId, { month, timezoneOffset: userTimezoneOffset });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
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
    annotations: { readOnlyHint: true },
  },
  async ({ days }) => {
    const result = await getUpcomingBills(prisma, userId, { days, timezoneOffset: userTimezoneOffset });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
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
    annotations: { readOnlyHint: true },
  },
  async ({ type }) => {
    const result = await getCategoryList(prisma, userId, { type });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Start server ---

const main = async () => {
  // Resolve the user before serving anything. Without this a typo'd BUDGET_USER_ID
  // connects happily and every tool returns zeros and empty arrays, which reads as
  // "you have no transactions" rather than "you are misconfigured".
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezoneOffset: true },
  });

  if (!user) {
    console.error(
      `No user found for BUDGET_USER_ID="${userId}". Check the id against the User table ` +
        `(pnpm db:studio) and that DATABASE_URL points at the right database.`
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  userTimezoneOffset = user.timezoneOffset;

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Claude Desktop stops the server by signalling it. Release the pool explicitly rather
  // than leaving it to process teardown.
  const shutdown = async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
