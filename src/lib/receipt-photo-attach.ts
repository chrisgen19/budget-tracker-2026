/**
 * Attaching one receipt photo to transactions that already exist: the MCP `attach_receipt_photo`
 * tool's whole write, kept out of `server.ts` so it can be read and tested on its own.
 *
 * Loads sharp and the R2 client through `receipt-photos.ts`, so the MCP server imports this
 * lazily inside the tool handler, the way `scan_receipt` imports `receipt-scan`.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { looksLikeHeicBytes } from "@/lib/heic";
import { UnreadableImageError } from "@/lib/receipt-photo-image";
import { applyPhotoChange, type PhotoEditStamp } from "@/lib/receipt-photo-links";
import type { PhotoStorage } from "@/lib/receipt-photo-storage";
import { deleteUnreferencedPhotos, storeReceiptPhoto } from "@/lib/receipt-photos";
import { BATCH_TX_OPTIONS } from "@/lib/transaction-writes";

/** What the tool returns on success. Pinned by `attachReceiptPhotoOutput` with `assertExact`. */
export interface AttachReceiptPhotoPayload {
  photoId: string;
  /** Every transaction now showing this photo, by id: the listed ones plus any sibling a replace
   *  moved with them. */
  attachedTo: string[];
  /** True when this `photoKey` was stored before, so nothing new was uploaded. */
  replayed: boolean;
}

export type AttachReceiptPhotoResult =
  | ({ ok: true } & AttachReceiptPhotoPayload)
  | { ok: false; reason: "TRANSACTIONS_NOT_OWNED"; ids: string[] }
  | { ok: false; reason: "UNREADABLE_IMAGE" }
  | { ok: false; reason: "UNSUPPORTED_HEIC" }
  | { ok: false; reason: "NO_LONGER_PERMITTED" };

export interface AttachReceiptPhotoParams {
  userId: string;
  transactionIds: string[];
  photoKey: string;
  bytes: Uint8Array;
  /** Provenance for every row the link moves: the token's source and id. */
  stamp: PhotoEditStamp;
  /** Re-reads the write lease inside the transaction, as the other MCP writes do. */
  assertStillPermitted: (tx: Prisma.TransactionClient) => Promise<boolean>;
}

class LinkRefused extends Error {
  constructor(readonly result: Exclude<AttachReceiptPhotoResult, { ok: true }>) {
    super(result.reason);
  }
}

const notOwned = (requested: string[], found: { id: string }[]) => {
  const have = new Set(found.map((r) => r.id));
  return requested.filter((id) => !have.has(id));
};

/**
 * Locks the named rows, then moves each one onto `photoId` through `applyPhotoChange`, so a row
 * that already had a different photo is a replace under the app's own repoint rule. Returns the
 * photos that may have lost their last row, and every row now on `photoId`.
 */
const linkInsideTransaction = async (
  prisma: PrismaClient,
  photoId: string,
  ids: string[],
  params: AttachReceiptPhotoParams,
): Promise<{ attachedTo: string[]; orphaned: string[] }> =>
  prisma.$transaction(async (tx) => {
    if (!(await params.assertStillPermitted(tx))) {
      throw new LinkRefused({ ok: false, reason: "NO_LONGER_PERMITTED" });
    }
    // The first statement on the transaction rows (`assertStillPermitted` reads the user row
    // before it, which is harmless under READ COMMITTED), ordered by id as `lockTransactionRows`
    // does, so the previous photo read here is the one the write replaces and two attaches over
    // the same rows wait, not deadlock. A concurrent MCP replace and app replace on overlapping
    // rows can still deadlock; Postgres then aborts one side and the data stays correct.
    const locked = await tx.$queryRaw<{ id: string; receiptPhotoId: string | null }[]>`
      SELECT id, receipt_photo_id AS "receiptPhotoId" FROM transactions
      WHERE user_id = ${params.userId} AND id = ANY(${ids})
      ORDER BY id
      FOR UPDATE
    `;
    const missing = notOwned(ids, locked);
    if (missing.length > 0) {
      throw new LinkRefused({ ok: false, reason: "TRANSACTIONS_NOT_OWNED", ids: missing });
    }
    const orphaned: string[] = [];
    for (const row of locked) {
      const change = await applyPhotoChange(
        tx,
        params.userId,
        row.id,
        photoId,
        row.receiptPhotoId,
        params.stamp,
      );
      orphaned.push(...change.orphaned);
    }
    const attached = await tx.transaction.findMany({
      where: { userId: params.userId, receiptPhotoId: photoId },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return { attachedTo: attached.map((t) => t.id), orphaned };
    // Up to 50 rows, each two or three awaited statements: past Prisma's 5s default on a slow
    // day, which would roll the links back after the photo was already stored.
  }, BATCH_TX_OPTIONS);

/** Best effort: a committed attach must not fail because a stale object could not be removed. */
const cleanUp = async (deps: { prisma: PrismaClient; storage: PhotoStorage }, userId: string, ids: string[]) => {
  if (ids.length === 0) return;
  try {
    await deleteUnreferencedPhotos(deps, userId, ids);
  } catch (error) {
    console.warn(
      "[receipt-photos] attach cleanup failed, leaving orphans for the prune script:",
      error instanceof Error ? error.message : error,
    );
  }
};

/**
 * Stores one photo (idempotent on `photoKey`) and attaches it to every listed transaction.
 *
 * Ownership is checked **before** anything is stored, so a request naming somebody else's row
 * uploads nothing. It is checked again under the row lock, since a row can be deleted between the
 * two. A photo whose link was then refused is cleaned up again; one replaced by this attach is
 * deleted once no row references it, after the commit.
 *
 * @throws whatever the storage or the database throws, other than an unreadable image.
 */
export const attachReceiptPhoto = async (
  deps: { prisma: PrismaClient; storage: PhotoStorage },
  params: AttachReceiptPhotoParams,
): Promise<AttachReceiptPhotoResult> => {
  const { prisma } = deps;
  const ids = [...new Set(params.transactionIds)];
  const owned = await prisma.transaction.findMany({
    where: { id: { in: ids }, userId: params.userId },
    select: { id: true },
  });
  const missing = notOwned(ids, owned);
  if (missing.length > 0) return { ok: false, reason: "TRANSACTIONS_NOT_OWNED", ids: missing };

  let stored: Awaited<ReturnType<typeof storeReceiptPhoto>>;
  try {
    stored = await storeReceiptPhoto(deps, {
      userId: params.userId,
      photoKey: params.photoKey,
      bytes: params.bytes,
    });
  } catch (error) {
    if (error instanceof UnreadableImageError) {
      const heic = looksLikeHeicBytes(params.bytes);
      return { ok: false, reason: heic ? "UNSUPPORTED_HEIC" : "UNREADABLE_IMAGE" };
    }
    throw error;
  }
  const photoId = stored.photo.id;

  let linked: { attachedTo: string[]; orphaned: string[] };
  try {
    linked = await linkInsideTransaction(prisma, photoId, ids, params);
  } catch (error) {
    if (!stored.replayed) await cleanUp(deps, params.userId, [photoId]);
    if (error instanceof LinkRefused) return error.result;
    throw error;
  }

  const orphaned = [...new Set(linked.orphaned)].filter((id) => id !== photoId);
  await cleanUp(deps, params.userId, orphaned);
  return { ok: true, photoId, attachedTo: linked.attachedTo, replayed: stored.replayed };
};
