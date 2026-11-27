import type { PendingScan } from "@/lib/telegram/pending-scan";
import { UnconfirmedWriteError } from "@/lib/telegram/errors";
import { PHOTOS_NOT_CONFIGURED_MESSAGE } from "@/lib/mcp/write-errors";

/**
 * The row a confirmed scan writes.
 *
 * Extracted from the call site so the one rule worth pinning is testable: `labelIds` is sent
 * *only* when the user named a label, and omitted otherwise.
 *
 * Both halves matter and they pull in opposite directions. Omitting it lets the server's
 * auto-apply schedules run, which is what should happen when nobody asked for anything. Sending
 * an explicit array overrides the server's `hasTrustworthyTime` coercion, which turns an omitted
 * `labelIds` into an opt-out for any date that is not today — right for a *schedule*, whose whole
 * premise is a real clock a backdated receipt does not have, and wrong for a label the user named
 * themselves. A receipt scanned the morning after the purchase hits that path every time, which
 * is how "label it in pickleball" reached the server and was dropped.
 */
export const scanToTransaction = (scan: PendingScan): Record<string, unknown> => ({
  amount: scan.amount,
  description: scan.description,
  type: "EXPENSE",
  categoryId: scan.categoryId,
  date: scan.date,
  ...(scan.labelIds.length > 0 && { labelIds: scan.labelIds }),
});

/** A batch as `create_transactions` returns it, narrowed to what this step reads. */
export interface SavedBatch {
  transactions: unknown[];
}

export interface ConfirmScanDeps {
  /** Writes the batch. Throws on a refusal or an unconfirmed write, as `createTransactions` does. */
  save: (clientBatchId: string, scan: PendingScan) => Promise<SavedBatch>;
  /**
   * Puts the scan back so a retry does not have to buy the same information again.
   *
   * `frozen` says the write never settled, so nobody knows whether the row exists. The retry
   * replays the same key, and if the first write did commit the server returns the original row —
   * so an edit made in between would be silently discarded. The caller must refuse edits in that
   * state, exactly as the web app's review freezes rows pinned by an unknown outcome.
   */
  restore: (scan: PendingScan, opts: { frozen: boolean }) => void;
  /** The idempotency key for this scan. Derived from the photo's update id. */
  batchKey: (scan: PendingScan) => string;
  /**
   * Keeps the receipt photo on the rows just saved (`attach_receipt_photo`). Called only after a
   * save that landed, with the same key the save used, which doubles as the photo's idempotency
   * key: a redelivered "yes" replays both halves rather than uploading a second copy.
   */
  attachPhoto?: (transactionIds: string[], photoKey: string, scan: PendingScan) => Promise<void>;
}

/**
 * What happened to the photo after a save landed. `none` means there was nothing to attach;
 * `unavailable` means this server has no photo storage, which is not a failure worth reporting.
 */
export type PhotoOutcome = "attached" | "failed" | "unavailable" | "none";

export type ConfirmOutcome =
  | { status: "saved"; batch: SavedBatch; photo: PhotoOutcome }
  /** Nothing was written and the scan is pending again, so the user can simply answer yes. */
  | { status: "retryable" };

/** Appended to the save confirmation when the photo did not make it. The save itself stands. */
export const PHOTO_UPLOAD_FAILED_NOTICE = "The photo didn't upload: attach it from the app.";

/** The notice for an outcome, or "" when there is nothing to say. */
export const photoNotice = (outcome: ConfirmOutcome): string =>
  outcome.status === "saved" && outcome.photo === "failed" ? PHOTO_UPLOAD_FAILED_NOTICE : "";

const savedIds = (batch: SavedBatch): string[] =>
  batch.transactions
    .map((t) => (t && typeof t === "object" ? (t as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string" && id !== "");

/**
 * Attach the scan's photo to a batch that has already been saved. Never throws: the rows exist,
 * and a photo that failed is a line in the confirmation, never a failed save.
 */
const attachSavedPhoto = async (
  scan: PendingScan,
  batch: SavedBatch,
  deps: ConfirmScanDeps
): Promise<PhotoOutcome> => {
  if (!scan.imageBase64 || !deps.attachPhoto) return "none";
  const ids = savedIds(batch);
  if (ids.length === 0) return "failed";
  try {
    await deps.attachPhoto(ids, deps.batchKey(scan), scan);
    return "attached";
  } catch (err) {
    if (err instanceof Error && err.message.trim() === PHOTOS_NOT_CONFIGURED_MESSAGE) {
      return "unavailable";
    }
    return "failed";
  }
};

/**
 * Save a scan the user has just confirmed, keeping it recoverable if the save does not land.
 *
 * The scan is taken from the pending map before this runs, so every failure path has to put it
 * back. A consumed-and-lost scan costs the user a real scan credit: the only way to get the
 * information again is to send the photo a second time.
 *
 * Restoring is safe rather than merely convenient. The idempotency key derives from the photo's
 * update id, not from the confirming message, so a retried "yes" replays the same batch and
 * returns the original rows instead of writing a second one. That holds even for an unconfirmed
 * write, which is exactly the case where a duplicate would otherwise be created.
 *
 * A thrown error is rethrown after restoring: the caller reports the server's own message, which
 * is the only text that says what to do next. The common case is not exotic, since
 * `mcp_writes_enabled_until` is a lease and lapses by design.
 */
export async function confirmPendingScan(
  scan: PendingScan,
  deps: ConfirmScanDeps
): Promise<ConfirmOutcome> {
  let batch: SavedBatch;
  try {
    batch = await deps.save(deps.batchKey(scan), scan);
  } catch (err) {
    // Only an unsettled write is ambiguous. A refusal the server authored — a lapsed write
    // lease is the common one — is raised before anything is written, so that draft stays editable.
    deps.restore(scan, { frozen: err instanceof UnconfirmedWriteError });
    throw err;
  }

  if (batch.transactions.length > 0) {
    return { status: "saved", batch, photo: await attachSavedPhoto(scan, batch, deps) };
  }

  // The call returned and wrote nothing, so there is nothing to be ambiguous about.
  deps.restore(scan, { frozen: false });
  return { status: "retryable" };
}
