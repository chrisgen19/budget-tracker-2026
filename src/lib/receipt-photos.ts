import { Prisma, type PrismaClient } from "@prisma/client";
import { normaliseReceiptPhoto } from "@/lib/receipt-photo-image";
import {
  createPhotoStorage,
  photoObjectKey,
  receiptPhotosEnabled,
  type PhotoStorage,
} from "@/lib/receipt-photo-storage";
import { formatLocalDate } from "@/lib/validations";

// The linking helpers live in their own module so the shared create path can use them without
// loading sharp or the R2 client; re-exported so this stays the one place to import photo rules.
export {
  applyPhotoChange,
  PHOTO_NOT_FOUND_MESSAGE,
  photosAreOwned,
  ReceiptPhotoNotOwnedError,
} from "@/lib/receipt-photo-links";

export type ReceiptPhotoView = {
  id: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
};

export type ReceiptPhotoInfo = {
  photo: ReceiptPhotoView;
  transactions: {
    id: string;
    description: string;
    amount: number;
    type: "INCOME" | "EXPENSE";
    categoryName: string;
    localDate: string;
  }[];
  total: number;
};

interface PhotoDeps {
  prisma: PrismaClient;
  storage: PhotoStorage;
}

const toView = (row: {
  id: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: Date;
}): ReceiptPhotoView => ({
  id: row.id,
  width: row.width,
  height: row.height,
  byteSize: row.byteSize,
  createdAt: row.createdAt.toISOString(),
});

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Re-encodes and stores a receipt photo. Idempotent on `(userId, photoKey)`: a retry returns the
 * existing photo with `replayed: true` and writes nothing to R2.
 *
 * Order is object first, row second, so a row never points at a missing object. If the row
 * insert fails the object is deleted again (best effort) and the error rethrown.
 *
 * @throws {UnreadableImageError} when the bytes are not an image.
 */
export const storeReceiptPhoto = async (
  { prisma, storage }: PhotoDeps,
  params: { userId: string; photoKey: string; bytes: Uint8Array },
): Promise<{ photo: ReceiptPhotoView; replayed: boolean }> => {
  const { userId, photoKey } = params;
  const lookup = { where: { userId_photoKey: { userId, photoKey } } };

  const existing = await prisma.receiptPhoto.findUnique(lookup);
  if (existing) return { photo: toView(existing), replayed: true };

  const normalised = await normaliseReceiptPhoto(params.bytes);
  const id = crypto.randomUUID();
  const objectKey = photoObjectKey(userId, id);
  await storage.put(objectKey, normalised.bytes, "image/jpeg");

  try {
    const created = await prisma.receiptPhoto.create({
      data: {
        id,
        userId,
        objectKey,
        contentType: "image/jpeg",
        byteSize: normalised.bytes.byteLength,
        width: normalised.width,
        height: normalised.height,
        photoKey,
      },
    });
    return { photo: toView(created), replayed: false };
  } catch (error) {
    await storage.delete(objectKey).catch(() => undefined);
    if (isUniqueViolation(error)) {
      const winner = await prisma.receiptPhoto.findUnique(lookup);
      if (winner) return { photo: toView(winner), replayed: true };
    }
    throw error;
  }
};

/** The photo with the transactions attached to it, or null when it is not this user's. */
export const getReceiptPhotoInfo = async (
  prisma: PrismaClient,
  userId: string,
  photoId: string,
): Promise<ReceiptPhotoInfo | null> => {
  const photo = await prisma.receiptPhoto.findFirst({
    where: { id: photoId, userId },
    include: {
      transactions: {
        orderBy: { date: "asc" },
        select: {
          id: true,
          description: true,
          amount: true,
          type: true,
          date: true,
          category: { select: { name: true } },
        },
      },
    },
  });
  if (!photo) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezoneOffset: true },
  });
  const offset = user?.timezoneOffset ?? 0;

  const transactions = photo.transactions.map((t) => ({
    id: t.id,
    description: t.description,
    amount: t.amount,
    type: t.type,
    categoryName: t.category.name,
    localDate: formatLocalDate(t.date, offset),
  }));
  const total = Math.round(transactions.reduce((sum, t) => sum + t.amount, 0) * 100) / 100;
  return { photo: toView(photo), transactions, total };
};

/**
 * Deletes photos no transaction references any more. The row goes first, through a guarded
 * `deleteMany`, and the R2 object only follows when that row was really removed: a transaction
 * may link the photo between the read and the delete, and deleting the object first would leave
 * a still-referenced row pointing at nothing. If the object delete then fails, the row deletion
 * stands (an orphaned object is harmless and a prune script can remove it) and the error
 * surfaces. Returns the ids actually deleted.
 */
export const deleteUnreferencedPhotos = async (
  { prisma, storage }: PhotoDeps,
  userId: string,
  photoIds: string[],
): Promise<string[]> => {
  if (photoIds.length === 0) return [];
  const photos = await prisma.receiptPhoto.findMany({
    where: { id: { in: photoIds }, userId },
    select: { id: true, objectKey: true, _count: { select: { transactions: true } } },
  });
  const deleted: string[] = [];
  for (const photo of photos) {
    if (photo._count.transactions > 0) continue;
    const { count } = await prisma.receiptPhoto.deleteMany({
      where: { id: photo.id, userId, transactions: { none: {} } },
    });
    if (count !== 1) continue;
    await storage.delete(photo.objectKey);
    deleted.push(photo.id);
  }
  return deleted;
};

/**
 * Deletes whichever of these photos no transaction references any more. Call it only after the
 * write that unlinked them has committed.
 *
 * Never throws, so a storage failure cannot fail a transaction write that already succeeded: it
 * warns and leaves the orphan for the prune script. With photos disabled there is no storage to
 * call, so it does nothing and the orphans wait for the same script.
 */
export const cleanUpReceiptPhotos = async (
  prisma: PrismaClient,
  userId: string,
  photoIds: string[],
): Promise<void> => {
  const ids = [...new Set(photoIds)];
  if (ids.length === 0 || !receiptPhotosEnabled()) return;
  try {
    await deleteUnreferencedPhotos({ prisma, storage: createPhotoStorage() }, userId, ids);
  } catch (error) {
    console.warn(
      "[receipt-photos] cleanup failed, leaving orphans for the prune script:",
      error instanceof Error ? error.message : error,
    );
  }
};
