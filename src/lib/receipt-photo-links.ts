/**
 * Linking receipt photos to transactions, inside a write transaction.
 *
 * Database only, on purpose: `createTransactionBatch` imports this, and it is shared by the MCP
 * server and the Telegram paths, which must not load sharp or the R2 client to create a row.
 */
import type { Prisma, TransactionSource } from "@prisma/client";

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
 * Another user's photo and a nonexistent one are deliberately indistinguishable. Takes `FOR KEY
 * SHARE` on the photo rows, so a concurrent `deleteUnreferencedPhotos` that commits first turns
 * into a clean "Photo not found" refusal rather than a foreign-key failure at the insert.
 */
export const photosAreOwned = async (
  tx: Prisma.TransactionClient,
  userId: string,
  photoIds: string[],
): Promise<boolean> => {
  const ids = [...new Set(photoIds)];
  if (ids.length === 0) return true;
  ids.sort();
  // FOR KEY SHARE, the lock the foreign key takes anyway, taken before the decision rather than at
  // the insert. If `deleteUnreferencedPhotos` holds its FOR UPDATE first, this waits, then reads
  // the photo as gone and the write is refused with "Photo not found" instead of failing the
  // insert on the foreign key. If this gets there first, the cleanup waits and then sees the new
  // link. Shared, so concurrent writers onto one photo do not serialise; `ORDER BY id` so two
  // writers naming the same photos cannot deadlock.
  const owned = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM receipt_photos
    WHERE id = ANY(${ids}) AND user_id = ${userId}
    ORDER BY id
    FOR KEY SHARE
  `;
  return owned.length === ids.length;
};

/** Who made a photo-link change, written onto every row it moves. */
export interface PhotoEditStamp {
  updatedVia: TransactionSource;
  updatedByMcpTokenId: string | null;
}

/** A photo-link change is an edit made in the app, so it is stamped like any other. */
const APP_EDIT_STAMP: PhotoEditStamp = { updatedVia: "APP", updatedByMcpTokenId: null };

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
 * Rows that change are stamped with `stamp`: by default `updated_via: APP` with no MCP token id,
 * which is what every app route wants. The MCP `attach_receipt_photo` tool passes its own token's
 * source and id instead, so a photo attached by the Telegram bot does not claim the app did it.
 * An unchanged link
 * writes nothing. Returns the photo ids that may now be unreferenced, for the caller to hand to
 * `cleanUpReceiptPhotos` **after** the transaction commits.
 *
 * @throws {ReceiptPhotoNotOwnedError} when `next` is not this user's photo; nothing is written.
 */
/**
 * Moves one transaction onto `next` through `applyPhotoChange`, judged against the photo the row
 * holds **now**, read under `FOR UPDATE` as the caller's first statement on it.
 *
 * The edit route used to pass the photo it had read before its transaction opened. A replace that
 * committed in between (the receipt's rows moved from P to Q) then ran as a replace of P, found no
 * rows on P but this one, and moved this row alone: a split receipt showing two photos. Same
 * shape as `linkInsideTransaction` in `receipt-photo-attach.ts`, and the same accepted risk: a
 * concurrent replace over overlapping rows can deadlock, and Postgres then aborts one side with
 * the data intact. A row that has gone since moves nothing.
 */
export const changePhotoUnderLock = async (
  tx: Prisma.TransactionClient,
  userId: string,
  transactionId: string,
  next: string | null,
  stamp: PhotoEditStamp = APP_EDIT_STAMP,
): Promise<{ orphaned: string[] }> => {
  const [current] = await tx.$queryRaw<{ receiptPhotoId: string | null }[]>`
    SELECT receipt_photo_id AS "receiptPhotoId" FROM transactions
    WHERE id = ${transactionId} AND user_id = ${userId}
    FOR UPDATE
  `;
  if (!current) return { orphaned: [] };
  return applyPhotoChange(tx, userId, transactionId, next, current.receiptPhotoId, stamp);
};

export const applyPhotoChange = async (
  tx: Prisma.TransactionClient,
  userId: string,
  transactionId: string,
  next: string | null,
  previous: string | null,
  stamp: PhotoEditStamp = APP_EDIT_STAMP,
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
      data: { receiptPhotoId: next, ...stamp },
    });
    return { orphaned: [previous] };
  }

  if (next !== null && !(await photosAreOwned(tx, userId, [next]))) {
    throw new ReceiptPhotoNotOwnedError();
  }
  await tx.transaction.updateMany({
    where: { id: transactionId, userId },
    data: { receiptPhotoId: next, ...stamp },
  });
  return { orphaned: previous === null ? [] : [previous] };
};
