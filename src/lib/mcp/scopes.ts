import { z } from "zod";

/**
 * What a remote MCP token is allowed to read.
 *
 * Every tool is read-only, so scoping by *verb* would be meaningless here; the useful axis is
 * subject matter. A token pasted into a third-party config can therefore be narrowed to, say,
 * bills only, instead of granting the whole financial history. Out-of-scope tools are removed
 * from the server before it is served rather than rejected on call, so a scoped token never
 * advertises capabilities it cannot use.
 */
export const MCP_SCOPES = [
  "budget:read",
  "transactions:read",
  "labels:read",
  "bills:read",
  "receipts:read",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const mcpScopeSchema = z.enum(MCP_SCOPES);

/** Human-readable descriptions, shown next to each checkbox when minting a token.
 *
 *  These have to describe what the tools *return*, not what they are named after. `receipts:read`
 *  and `bills:read` both carry the parent transaction's description and amount, so a token
 *  narrowed to either still exposes individual transactions; a label implying otherwise would
 *  make the scope picker actively misleading about what is being handed over. */
export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  "budget:read": "Monthly totals, category breakdowns, trends, and the category list",
  "transactions:read": "Individual transactions, search, and largest expenses",
  "labels:read": "Labels and spending grouped by label",
  "bills:read":
    "Recurring bills, what is due, and payment history (including the amount paid for each)",
  "receipts:read":
    "Line items from scanned receipts, each with its transaction's description, amount, and date",
};

/**
 * Which scope each tool belongs to.
 *
 * Keyed by the exact tool name registered in `server.ts`. A tool added there without an entry
 * here is removed from every token, which fails visibly (the tool is simply absent) rather than
 * silently serving data no scope was granted for.
 */
export const MCP_TOOL_SCOPES = {
  get_spending_by_category: "budget:read",
  get_monthly_summary: "budget:read",
  get_spending_trends: "budget:read",
  get_budget_overview: "budget:read",
  get_category_list: "budget:read",
  get_top_expenses: "transactions:read",
  search_transactions: "transactions:read",
  get_label_breakdown: "labels:read",
  get_label_list: "labels:read",
  get_upcoming_bills: "bills:read",
  get_bill_history: "bills:read",
  get_receipt_items: "receipts:read",
} as const satisfies Record<string, McpScope>;

export type McpToolName = keyof typeof MCP_TOOL_SCOPES;

/** Keep only the scopes this build knows about, preserving declaration order. */
export const parseScopes = (values: string[]): McpScope[] =>
  MCP_SCOPES.filter((scope) => values.includes(scope));
