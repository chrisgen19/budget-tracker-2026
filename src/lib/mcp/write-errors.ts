import type { BatchFailureReason, UpdateFailureReason } from "@/lib/transaction-writes";
import type { BillActionFailureReason, BillWriteFailureReason } from "@/lib/bill-writes";
import type { LabelWriteFailureReason } from "@/lib/label-writes";
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
  LABELS_NOT_IN_CATEGORY:
    "One or more labels are limited to categories that do not include the one the transaction is filed under. Nothing was written. Call get_label_list with that `categoryId` to see which labels it accepts, then send only those or drop `labelIds`.",
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
 * What `update_transactions` says when an edit fails, in the same voice as the create table above.
 *
 * A separate map rather than entries bolted onto `WRITE_ERROR_MESSAGES`, which is total over
 * `BatchFailureReason`: sharing one map would make every create failure a reachable answer for an
 * edit and vice versa, and the compiler would stop objecting to either.
 *
 * Every one of these is deterministic and, crucially, leaves the batch untouched -- an update runs
 * as one transaction with no idempotency key, so there is no `UNKNOWN_WHETHER_SAVED` analogue here
 * and nothing a caller has to replay to find out what happened. Each message says what to change,
 * because a model that cannot tell "you asked for the impossible" from "try again" will do the
 * wrong one.
 */
export const UPDATE_ERROR_MESSAGES: Record<UpdateFailureReason, string> = {
  NOT_FOUND:
    "One or more transaction IDs do not exist on this account. Nothing was changed. Call search_transactions or get_top_expenses for current IDs.",
  NO_FIELDS:
    "Every transaction must name at least one field to change. Nothing was changed. Send the fields you want to differ and omit the rest.",
  LABELS_NOT_IN_CATEGORY:
    "One or more labels being added are limited to categories that do not include the transaction's effective category. Nothing was changed. Labels already on a row are never refused, so this names only a label the patch adds. Call get_label_list with that `categoryId` to see which labels it accepts.",
  DUPLICATE_ID:
    "The same transaction ID appeared more than once. Nothing was changed. Combine the edits for that transaction into a single entry.",
  LABELS_NOT_OWNED:
    "One or more label IDs are not this user's. Nothing was changed. Call get_label_list for valid IDs.",
  // The likeliest cause is not a bad category id at all: it is changing `type` while leaving
  // `categoryId` alone, which leaves an expense filed under an income category. Named here so the
  // model fixes the real problem rather than re-sending the same id.
  CATEGORIES_NOT_OWNED:
    "One or more category IDs are not this user's, or do not match the transaction's type. Nothing was changed. If you changed `type`, send a `categoryId` of that same type as well; call get_category_list for valid IDs.",
  NO_LONGER_PERMITTED:
    "Writes were switched off before these could be changed, so nothing was changed. Turn them on in Profile > MCP Access, then try again.",
  WRITE_REJECTED:
    "The update refers to something that no longer exists -- most likely a category or label deleted while the request was in flight. Nothing was changed. Re-read the current categories and labels and build the request again; sending the same one will fail the same way.",
  WRITE_FAILED:
    "The update failed and was rolled back, so nothing was changed and every transaction is exactly as it was. Try the same request again.",
};

/**
 * What `pay_bill` says when settling an occurrence fails.
 *
 * Every one of these leaves the bill exactly as it was: each check runs before or inside the same
 * transaction as the write, so there is no ambiguous outcome here and nothing a caller has to
 * replay to find out what happened. Each message says what to do instead, because the two that
 * look alike are the ones a model would otherwise get wrong -- `ALREADY_SETTLED` means the work is
 * already done and retrying is the mistake, while `AMOUNT_REQUIRED` means the same call with one
 * more field will succeed.
 */
export const BILL_ACTION_ERROR_MESSAGES: Record<BillActionFailureReason, string> = {
  BILL_NOT_FOUND:
    "No bill with that ID on this account. Nothing was changed. Call get_upcoming_bills for current bill IDs.",
  // The date has to name an occurrence the schedule actually produces. A phantom one used to be
  // accepted, writing a payment and a history entry against a month that does not exist while the
  // cursor stayed put and the reminder kept firing.
  NOT_AN_OCCURRENCE:
    "That date is not one this bill's schedule falls on, so there is no occurrence to settle. Nothing was changed. Use the `localDueDate` from get_upcoming_bills, or an occurrence's own date from get_bill_history -- do not compute the date yourself.",
  // The likeliest cause is not a race: it is acting twice on one occurrence, which is exactly what
  // the guard exists to stop. Saying "already done" rather than "failed" matters, because a model
  // told a write failed will retry it.
  ALREADY_SETTLED:
    "That occurrence has already been paid or skipped, so nothing was changed and nothing needs to be. Do not retry. Call get_bill_history to see how it was settled, or get_upcoming_bills for the next due date.",
  AMOUNT_REQUIRED:
    "This bill's amount varies month to month, so its stored amount is only a forecast and cannot be written to the ledger as if it were the payment. Nothing was changed. Ask the user what they actually paid and send it as `amount`.",
  TRANSACTION_NOT_FOUND:
    "That transaction ID is not this user's. Nothing was changed. Call search_transactions for the payment you meant to link.",
  // Ownership alone was the whole check once, and it let an income row settle an expense bill.
  TRANSACTION_TYPE_MISMATCH:
    "That transaction is the opposite type from the bill, so it cannot be the payment for it. Nothing was changed. Call search_transactions for one matching the bill's own type.",
  TRANSACTION_OUTSIDE_WINDOW:
    "That payment is more than two weeks from this occurrence's due date, so it is not settling this one. Nothing was changed. Pick a payment nearer the due date, or settle the occurrence that payment actually belongs to.",
  PAYMENT_ALREADY_LINKED:
    "That payment is already linked to another bill, so linking it here would leave the other bill's history pointing at a payment it no longer owns. Nothing was changed. Pick a different transaction, or use `pay` to record a new one.",
  NO_LONGER_PERMITTED:
    "Writes were switched off before this could be saved, so nothing was changed. Turn them on in Profile > MCP Access, then try again.",
};

/**
 * What `create_bill` and `update_bill` say when defining a bill fails.
 *
 * Shared by both, since the failures are the same question asked of a new row or an edited one.
 * `CATEGORY_NOT_USABLE` names the cause a model will not guess: the usual reason is not a bad id
 * at all but changing `type` while leaving `categoryId` alone, which would file an income bill
 * under a food category and distort every breakdown that groups by one.
 */
export const BILL_WRITE_ERROR_MESSAGES: Record<BillWriteFailureReason, string> = {
  BILL_NOT_FOUND:
    "No bill with that ID on this account. Nothing was changed. Call get_upcoming_bills for current bill IDs.",
  CATEGORY_NOT_USABLE:
    "That category is not this user's, or its type does not match the bill's. Nothing was changed. If you changed `type`, send a `categoryId` of that same type as well; call get_category_list for valid IDs.",
  LABELS_NOT_OWNED:
    "One or more label IDs are not this user's. Nothing was changed. Call get_label_list for valid IDs, or create_label to make one.",
  LABELS_NOT_IN_CATEGORY:
    "One or more labels being added are limited to categories that do not include the bill's effective category. Nothing was changed. Labels already on the bill are never refused, so this names only a label this call adds. Call get_label_list with that `categoryId` to see which labels it accepts.",
  INVALID_SCHEDULE:
    "The schedule is not usable: a CUSTOM frequency needs `customIntervalDays`, and `endDate` cannot fall before `startDate`. Nothing was changed.",
  NO_FIELDS:
    "The patch named no fields to change. Nothing was changed. Send the fields you want to differ and omit the rest.",
  NO_LONGER_PERMITTED:
    "Writes were switched off before this could be saved, so nothing was changed. Turn them on in Profile > MCP Access, then try again.",
};

/** What `create_label` says when a label cannot be created. Names are matched without case, so
 *  "work" collides with an existing "Work" -- and it must, or the label resolver would report the
 *  two as ambiguous and refuse every mention of either. */
export const LABEL_WRITE_ERROR_MESSAGES: Record<LabelWriteFailureReason, string> = {
  DUPLICATE_NAME:
    "A label with that name already exists on this account (names are compared without case). Nothing was created. Call get_label_list and use the existing label's ID.",
  INVALID_CATEGORIES:
    "One or more `categoryIds` are not usable: unknown, not this user's, or of a type the label's `applicableTo` excludes. Nothing was created. Call get_category_list for valid IDs, or omit `categoryIds` to leave the label available on every category.",
  NO_LONGER_PERMITTED:
    "Writes were switched off before this could be saved, so nothing was created. Turn them on in Profile > MCP Access, then try again.",
};

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
