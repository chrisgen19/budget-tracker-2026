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

const server = new McpServer({
  name: "budgettracker",
  version: "1.0.0",
});

// --- Tool registrations ---

server.tool(
  "get_spending_by_category",
  "Get spending grouped by category for a given month. Returns expense categories sorted by amount with percentages.",
  {
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("Month in YYYY-MM format. Defaults to current month."),
  },
  async ({ month }) => {
    const result = await getSpendingByCategory(prisma, userId, { month });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "get_top_expenses",
  "Get the largest individual expense transactions, optionally filtered by month.",
  {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Number of results. Defaults to 10."),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("Month in YYYY-MM format. If omitted, returns all-time."),
  },
  async ({ limit, month }) => {
    const result = await getTopExpenses(prisma, userId, { limit, month });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "get_monthly_summary",
  "Get income, expenses, and net for each of the last N months. Good for trend analysis.",
  {
    months: z
      .number()
      .int()
      .min(1)
      .max(24)
      .optional()
      .describe("Number of months to look back. Defaults to 6."),
  },
  async ({ months }) => {
    const result = await getMonthlySummary(prisma, userId, { months });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "get_spending_trends",
  "Compare spending between two months, broken down by category. Shows which categories increased or decreased.",
  {
    currentMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe("Current period in YYYY-MM format."),
    previousMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe("Comparison period in YYYY-MM format."),
  },
  async ({ currentMonth, previousMonth }) => {
    const result = await getSpendingTrends(prisma, userId, {
      currentMonth,
      previousMonth,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "search_transactions",
  "Search and filter transactions by description, category, amount range, type, and month. Supports pagination and sorting.",
  {
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
      .regex(/^\d{4}-\d{2}$/)
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
  async (params) => {
    const result = await searchTransactions(prisma, userId, params);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "get_budget_overview",
  "Get a high-level monthly summary: total income, expenses, net, running balance, and transaction count.",
  {
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .describe("Month in YYYY-MM format. Defaults to current month."),
  },
  async ({ month }) => {
    const result = await getBudgetOverview(prisma, userId, { month });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "get_upcoming_bills",
  "Get scheduled transactions (bills) due within N days. Shows overdue bills too.",
  {
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe("Number of days to look ahead. Defaults to 7."),
  },
  async ({ days }) => {
    const result = await getUpcomingBills(prisma, userId, { days });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "get_category_list",
  "List all budget categories (both default and custom). Useful for finding category IDs to use with other tools.",
  {
    type: z
      .enum(["INCOME", "EXPENSE"])
      .optional()
      .describe("Filter by category type."),
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
