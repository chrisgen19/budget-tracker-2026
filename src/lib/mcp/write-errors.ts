import type { BatchFailureReason } from "@/lib/transaction-writes";
import type { ScanRefusal } from "@/lib/receipt-guard";
import type { ScanFailure } from "@/lib/receipt-scan";

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
  ACCOUNTS_NOT_OWNED:
    "One or more account IDs are not this user's, or name an archived account. Call get_account_balances for valid IDs.",
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

/**
 * What `scan_receipt` says when a scan is refused before it runs.
 *
 * Written for a model that has to decide what to do next, so each one says whether retrying could
 * ever work: a lapsed allowance cannot be retried today, a rate limit can be retried later, and a
 * disabled feature needs the user to change a setting.
 */
export const SCAN_REFUSAL_MESSAGES: Record<
  ScanRefusal["reason"],
  (refusal: ScanRefusal) => string
> = {
  UNAUTHORIZED: () => "That account no longer exists.",
  SCAN_DISABLED: (r) =>
    r.reason === "SCAN_DISABLED" && r.scope === "USER"
      ? "Receipt scanning is switched off for this account. Turn it on in Profile > Settings > Features."
      : "Receipt scanning is not available on this account's plan.",
  INVALID_TYPE: () => "That image format is not supported. Send a JPEG, PNG, WebP, HEIC or HEIF.",
  TOO_LARGE: () => "That image is over the 4 MB limit. Send a smaller or more compressed photo.",
  LIMIT_REACHED: (r) =>
    r.reason === "LIMIT_REACHED"
      ? `This account has used all ${r.limit} of its scans for the month (${r.used}/${r.limit}). The allowance resets next month; enter the transaction manually until then.`
      : "",
  RATE_LIMITED: (r) =>
    r.reason === "RATE_LIMITED"
      ? `Too many scans in a short time. Wait about ${Math.ceil(r.retryAfterSeconds / 60)} minute(s) and try the same image again.`
      : "",
};

/** What `scan_receipt` says when the scan ran but produced nothing usable. The credit is
 *  refunded in every one of these cases, so retrying costs the user nothing extra. */
export const SCAN_FAILURE_MESSAGES: Record<ScanFailure["reason"], string> = {
  NOT_A_RECEIPT: "That image does not look like a receipt. Ask the user for a photo of one.",
  UNREADABLE: "The receipt could not be read. Ask for a clearer, better-lit photo.",
  AI_UNAVAILABLE: "The scanning service is busy. Try the same image again in a minute.",
  FAILED: "The scan failed. Try the same image again.",
};
