import { Prisma, type PrismaClient } from "@prisma/client";
import { normaliseReceiptPhoto } from "@/lib/receipt-photo-image";
import { photoObjectKey, type PhotoStorage } from "@/lib/receipt-photo-storage";
import { formatLocalDate } from "@/lib/validations";

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
 * Deletes photos no transaction references any more: object first, then row, so a failure
 * between the two leaves a row that can be retried rather than an orphaned object.
 * Returns the ids actually deleted.
 */
export const deleteUnreferencedPhotos = async (
  { prisma, storage }: PhotoDeps,
  photoIds: string[],
): Promise<string[]> => {
  if (photoIds.length === 0) return [];
  const photos = await prisma.receiptPhoto.findMany({
    where: { id: { in: photoIds } },
    select: { id: true, objectKey: true, _count: { select: { transactions: true } } },
  });
  const deleted: string[] = [];
  for (const photo of photos) {
    if (photo._count.transactions > 0) continue;
    await storage.delete(photo.objectKey);
    await prisma.receiptPhoto.deleteMany({ where: { id: photo.id, transactions: { none: {} } } });
    deleted.push(photo.id);
  }
  return deleted;
};
