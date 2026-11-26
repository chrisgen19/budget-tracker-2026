import { uploadReceiptPhoto } from "@/hooks/use-receipt-photos";
import type { MultiScanItem } from "@/types";

/** Photo uploads in flight at once during a scan save. */
const PHOTO_UPLOAD_CONCURRENCY = 3;

/** One receipt's photo within a pending batch save. */
export interface ScanPhoto {
  /** The receipt's `receiptGroupId` for itemized rows, or the row's own id for a single one. */
  receiptKey: string;
  file: File;
  /** Generated once per receipt, so re-sending an upload replays rather than storing twice. */
  photoKey: string;
  /** Set once the server has stored the photo. */
  photoId?: string;
}

/** Which receipt a row came from: itemized rows share their group, anything else stands alone. */
export const receiptKeyOf = (item: MultiScanItem): string => item.data?.receiptGroupId ?? item.id;

/** One planned upload per distinct receipt that still holds its image. */
export const planScanPhotos = (items: MultiScanItem[]): ScanPhoto[] => {
  const byReceipt = new Map<string, ScanPhoto>();
  for (const item of items) {
    const receiptKey = receiptKeyOf(item);
    if (!item.imageFile || byReceipt.has(receiptKey)) continue;
    byReceipt.set(receiptKey, { receiptKey, file: item.imageFile, photoKey: crypto.randomUUID() });
  }
  return [...byReceipt.values()];
};

/**
 * Upload every planned photo that has no id yet, at most three at a time, under its own
 * `photoKey`. Never rejects: a failed upload only leaves that receipt without a `photoId`,
 * because a photo is never worth failing the save it belongs to. Returns new objects and
 * leaves the input alone, so the caller decides when the results become the pinned save.
 */
export const uploadScanPhotos = async (photos: ScanPhoto[]): Promise<ScanPhoto[]> => {
  const results = photos.map((photo) => ({ ...photo }));
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < results.length) {
      const photo = results[next++];
      if (photo.photoId) continue;
      try {
        photo.photoId = (await uploadReceiptPhoto(photo.file, photo.photoKey)).id;
      } catch {
        // Dropped on purpose: the receipt saves without its photo and the user is told.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PHOTO_UPLOAD_CONCURRENCY, results.length) }, worker),
  );
  return results;
};

/** Uploaded photo ids keyed by receipt. A receipt whose upload failed is absent. */
export const photoIdsByReceipt = (photos: ScanPhoto[]): Map<string, string> =>
  new Map(
    photos.flatMap((photo) => (photo.photoId ? [[photo.receiptKey, photo.photoId] as const] : [])),
  );
