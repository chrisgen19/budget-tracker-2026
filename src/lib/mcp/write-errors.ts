import type { BatchFailureReason } from "@/lib/transaction-writes";

/**
 * What `create_transactions` says when a write fails, defined once so a client can recognise it.
 *
 * These are prose, because the primary reader is a model. But one of them means something a
 * caller has to act on rather than relay: `UNKNOWN_WHETHER_SAVED` is *ambiguous*, not a refusal.
 * The rows may exist. The only safe response is to replay the same `clientBatchId`, which either
 * returns the original rows or writes them once.
 *
 * The Telegram bot cannot ask its user to do that: its idempotency key is derived from the
 * Telegram update id, so a retyped message is a new key and a second row. It therefore has to
 * recognise this case and replay it itself, which is why the text lives here rather than inline
 * in the tool, and why `mcp-write-errors.test.ts` pins the two ends together.
 */
export const WRITE_ERROR_MESSAGES: Record<BatchFailureReason, string> = {
  LABELS_NOT_OWNED: "One or more label IDs are not this user's. Call get_label_list for valid IDs.",
  CATEGORIES_NOT_OWNED:
    "One or more category IDs are not this user's. Call get_category_list for valid IDs.",
  // Writes were switched off between the request arriving and the rows being written. The check
  // runs inside the transaction before anything is created, so nothing was saved. Saying so
  // matters: it used to share the "could not confirm" wording below, which sent the caller
  // looking for rows that do not exist and invited a replay that can only fail again.
  NO_LONGER_PERMITTED:
    "Writes were switched off before these could be saved, so nothing was written. Turn them on in Profile > MCP Access, then try again.",
  UNKNOWN_WHETHER_SAVED:
    "Could not confirm whether these transactions were saved. Do NOT retry with a new clientBatchId: retry with the same one, which will return the original rows if they were written.",
};

/**
 * Whether a failure leaves the outcome genuinely unknown.
 *
 * True only for `UNKNOWN_WHETHER_SAVED`. Every other failure is deterministic: it happened before
 * any row was written and will happen again until the caller changes something.
 */
export const isAmbiguousWriteFailure = (message: string): boolean =>
  message.trim() === WRITE_ERROR_MESSAGES.UNKNOWN_WHETHER_SAVED;
