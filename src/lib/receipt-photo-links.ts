/**
 * Linking receipt photos to transactions, inside a write transaction.
 *
 * Database only, on purpose: `createTransactionBatch` imports this, and it is shared by the MCP
 * server and the Telegram paths, which must not load sharp or the R2 client to create a row.
 */
import type { Prisma } from "@prisma/client";

/** The one refusal every transaction write gives for an unowned or missing photo id. */
export const PHOTO_NOT_FOUND_MESSAGE = "Photo not found";

/** A photo id named on a write is not this user's, or does not exist. Rolls the write back. */
export class ReceiptPhotoNotOwnedError extends Error {
  constructor() {
    super(PHOTO_NOT_FOUND_MESSAGE);
    this.name = "ReceiptPhotoNotOwnedError";
  }
}

/**
 * Whether every id names a photo this user owns. Called inside the write transaction, before any
 * insert or update references the ids, the same placement as `categoriesAreUsableForWrite`.
 * Another user's photo and a nonexistent one are deliberately indistinguishable.
 */
export const photosAreOwned = async (
  tx: Prisma.TransactionClient,
  userId: string,
  photoIds: string[],
): Promise<boolean> => {
  const ids = [...new Set(photoIds)];
  if (ids.length === 0) return true;
  const owned = await tx.receiptPhoto.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true },
  });
  return owned.length === ids.length;
};

/** A photo-link change is an edit made in the app, so it is stamped like any other. */
const APP_EDIT_STAMP = { updatedVia: "APP", updatedByMcpTokenId: null } as const;

/**
 * Moves one transaction's photo link, inside the caller's write transaction.
 *
 * - **Replace** (`previous` set, `next` a different id): every row on `previous` moves to `next`,
 *   because the rows of one split receipt share one photo and replacing it for one of them only
 *   would leave the others showing the old picture of the same purchase. Takes `SELECT ... FOR
 *   UPDATE` on those rows (plus `transactionId`) ordered by id as its **first** statement, so a
 *   concurrent link to `previous` cannot slip between the decision and the write, and two replaces
 *   over overlapping rows wait rather than deadlock. Never weaken it to `FOR NO KEY UPDATE`; see
 *   `lockTransactionRows` in `transaction-writes.ts`.
 * - **Remove** (`next` null): unlinks `transactionId` only. Its siblings keep the photo.
 * - **Link** (`previous` null): attaches `next` to `transactionId` only.
 *
 * Rows that change are stamped `updated_via: APP` and lose their MCP token id. An unchanged link
 * writes nothing. Returns the photo ids that may now be unreferenced, for the caller to hand to
 * `cleanUpReceiptPhotos` **after** the transaction commits.
 *
 * @throws {ReceiptPhotoNotOwnedError} when `next` is not this user's photo; nothing is written.
 */
export const applyPhotoChange = async (
  tx: Prisma.TransactionClient,
  userId: string,
  transactionId: string,
  next: string | null,
  previous: string | null,
): Promise<{ orphaned: string[] }> => {
  if (next === previous) return { orphaned: [] };

  if (next !== null && previous !== null) {
    await tx.$queryRaw`
      SELECT id FROM transactions
      WHERE user_id = ${userId} AND (receipt_photo_id = ${previous} OR id = ${transactionId})
      ORDER BY id
      FOR UPDATE
    `;
    if (!(await photosAreOwned(tx, userId, [next]))) throw new ReceiptPhotoNotOwnedError();
    await tx.transaction.updateMany({
      where: { userId, OR: [{ receiptPhotoId: previous }, { id: transactionId }] },
      data: { receiptPhotoId: next, ...APP_EDIT_STAMP },
    });
    return { orphaned: [previous] };
  }

  if (next !== null && !(await photosAreOwned(tx, userId, [next]))) {
    throw new ReceiptPhotoNotOwnedError();
  }
  await tx.transaction.updateMany({
    where: { id: transactionId, userId },
    data: { receiptPhotoId: next, ...APP_EDIT_STAMP },
  });
  return { orphaned: previous === null ? [] : [previous] };
};
