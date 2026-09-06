import { z } from "zod";

/**
 * What a remote MCP token is allowed to read.
 *
 * Mostly scoped by subject matter rather than by verb: a token pasted into a third-party config
 * can be narrowed to, say, bills only, instead of granting the whole financial history.
 * Out-of-scope tools are removed from the server before it is served rather than rejected on
 * call, so a scoped token never advertises capabilities it cannot use.
 *
 * `transactions:write` covers both writes -- creating a row and changing one. Splitting editing
 * into its own scope is the safer shape on paper, since a leaked create-only credential can only
 * add junk that is visible and deletable while an edit-capable one can quietly rewrite recorded
 * history. It was reversed because the cost lands on the wrong person: every already-minted token
 * is powerless to edit until it is re-minted, and here that is the same individual who owns the
 * budget, paying a chore to narrow a credential only they hold. Revisit it if this ever serves
 * more than one person, or if a token is handed to something less trusted than the Telegram bot.
 * Tracked as its own issue rather than left as a comment nobody re-reads.
 */
export const MCP_SCOPES = [
  "budget:read",
  "transactions:read",
  "labels:read",
  "bills:read",
  "receipts:read",
  "receipts:scan",
  "transactions:write",
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
  "receipts:scan":
    "Read a receipt photo with AI and return the amount, date, and category. Spends one scan from your monthly allowance per call",
  "transactions:write":
    "Create new transactions, and change existing ones — amount, description, type, date, category and labels. Cannot delete anything. Also requires writes to be switched on below, and cannot be granted to a token that never expires",
};

/**
 * Every scope that lets the caller change data.
 *
 * An explicit list rather than `endsWith(":write")`, even though one entry makes the two behave
 * identically today. A suffix test decides authority by spelling: `receipts:scan` already slipped
 * past it once and needed `isPrivilegedScope` to be filed correctly, and a future
 * `transactions:edit` would land in `READ_ONLY_SCOPES` below -- the default grant, and what the
 * local stdio server runs with -- handing every caller that names no scopes the power to rewrite
 * rows. Enumerating costs one line and cannot be wrong by accident.
 */
const WRITE_SCOPES: readonly McpScope[] = ["transactions:write"];

/** True for scopes that let the caller change data. Used to force a bounded token lifetime at
 *  mint time and to decide whether the write lease has to be consulted. */
export const isWriteScope = (scope: McpScope): boolean => WRITE_SCOPES.includes(scope);

export const grantsWrite = (scopes: readonly McpScope[]): boolean => scopes.some(isWriteScope);

/**
 * Scopes that are not free to exercise, whether or not they write.
 *
 * `receipts:scan` writes nothing, but each call spends one of the user's monthly scans and costs
 * a real Gemini request. Judging it by its name alone would therefore have filed it under
 * read-only and put it in the default grant below, handing metered spend to every token that
 * names no scopes, including the local stdio server.
 */
export const isPrivilegedScope = (scope: McpScope): boolean =>
  isWriteScope(scope) || scope === "receipts:scan";

/** Every scope that neither changes data nor spends a metered resource. Also the default grant
 *  everywhere: a caller that does not name its scopes must not silently receive either. */
export const READ_ONLY_SCOPES: readonly McpScope[] = MCP_SCOPES.filter((s) => !isPrivilegedScope(s));

/** What the mint form starts with. A token that can change data has to be chosen deliberately, or
 *  an untouched form would hand out write authority and least privilege would depend on the user
 *  noticing a pre-ticked box. */
export const DEFAULT_MINT_SCOPES = READ_ONLY_SCOPES;

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
  scan_receipt: "receipts:scan",
  create_transactions: "transactions:write",
  update_transactions: "transactions:write",
} as const satisfies Record<string, McpScope>;

export type McpToolName = keyof typeof MCP_TOOL_SCOPES;

/** Keep only the scopes this build knows about, preserving declaration order. */
export const parseScopes = (values: string[]): McpScope[] =>
  MCP_SCOPES.filter((scope) => values.includes(scope));
