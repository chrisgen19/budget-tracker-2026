import type { PendingScan } from "@/lib/telegram/pending-scan";

/** A batch as `create_transactions` returns it, narrowed to what this step reads. */
export interface SavedBatch {
  transactions: unknown[];
}

export interface ConfirmScanDeps {
  /** Writes the batch. Throws on a refusal or an unconfirmed write, as `createTransactions` does. */
  save: (clientBatchId: string, scan: PendingScan) => Promise<SavedBatch>;
  /** Puts the scan back so a retry does not have to buy the same information again. */
  restore: (scan: PendingScan) => void;
  /** The idempotency key for this scan. Derived from the photo's update id. */
  batchKey: (scan: PendingScan) => string;
}

export type ConfirmOutcome =
  | { status: "saved"; batch: SavedBatch }
  /** Nothing was written and the scan is pending again, so the user can simply answer yes. */
  | { status: "retryable" };

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
    deps.restore(scan);
    throw err;
  }

  if (batch.transactions.length > 0) return { status: "saved", batch };

  deps.restore(scan);
  return { status: "retryable" };
}
