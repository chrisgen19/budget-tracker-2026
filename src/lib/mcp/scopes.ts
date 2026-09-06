import { z } from "zod";

/**
 * What a remote MCP token is allowed to read.
 *
 * Mostly scoped by subject matter rather than by verb: a token pasted into a third-party config
 * can be narrowed to, say, bills only, instead of granting the whole financial history.
 * Out-of-scope tools are removed from the server before it is served rather than rejected on
 * call, so a scoped token never advertises capabilities it cannot use.
 *
 * The two write scopes are the exception, and they are split by verb on purpose. Creating a row
 * and rewriting one are different powers: a leaked create-only credential can add junk that is
 * visible and deletable, while an edit-capable one can quietly change history that is already
 * recorded. Keeping them separate is what lets the Telegram bot hold `transactions:write` and
 * nothing more, which is the property `src/lib/telegram/app-link.ts` exists to preserve.
 */
export const MCP_SCOPES = [
  "budget:read",
  "transactions:read",
  "labels:read",
  "bills:read",
  "receipts:read",
  "receipts:scan",
  "transactions:write",
  "transactions:edit",
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
    "Create new transactions. Also requires writes to be switched on below, and cannot be granted to a token that never expires",
  "transactions:edit":
    "Change existing transactions: amount, description, type, date, category and labels. Cannot delete anything. Same two extra conditions as creating",
};

/**
 * Every scope that lets the caller change existing data.
 *
 * An explicit list, not `endsWith(":write")`. The suffix test read `transactions:edit` as
 * read-only, which put it in `READ_ONLY_SCOPES` below -- the default grant, and what the local
 * stdio server runs with -- so every caller that named no scopes would have silently received the
 * power to rewrite rows. That is the identical trap `receipts:scan` hit, and `isPrivilegedScope`
 * was written for; a name is not a permission model, so this one enumerates.
 */
const WRITE_SCOPES: readonly McpScope[] = ["transactions:write", "transactions:edit"];

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
  update_transactions: "transactions:edit",
} as const satisfies Record<string, McpScope>;

export type McpToolName = keyof typeof MCP_TOOL_SCOPES;

/** Keep only the scopes this build knows about, preserving declaration order. */
export const parseScopes = (values: string[]): McpScope[] =>
  MCP_SCOPES.filter((scope) => values.includes(scope));
