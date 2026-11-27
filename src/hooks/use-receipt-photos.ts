import { useQuery } from "@tanstack/react-query";
import { refusalFrom } from "@/hooks/api-error";
// Type-only: `@/lib/receipt-photos` loads sharp and must never reach the client bundle.
import type { ReceiptPhotoInfo, ReceiptPhotoView } from "@/lib/receipt-photos";

export const receiptPhotoKeys = {
  /** Prefix of every info query. Transaction writes invalidate it: the linked rows and the
   *  total are derived from transactions, so an edit or delete makes them stale. */
  all: ["receipt-photo-info"] as const,
  info: (photoId: string | null) => ["receipt-photo-info", photoId] as const,
};

/** The owner-checked route that serves a photo's bytes. */
export const receiptPhotoUrl = (photoId: string): string => `/api/receipt-photos/${photoId}`;

/**
 * Upload one photo. `photoKey` makes a retry after a lost response return the same photo
 * rather than storing a second. Rejects with `ApiRefusedError` (status + server message) on non-2xx.
 */
export const uploadReceiptPhoto = async (file: File, photoKey: string): Promise<ReceiptPhotoView> => {
  const body = new FormData();
  body.append("photo", file);
  body.append("photoKey", photoKey);
  const res = await fetch("/api/receipt-photos", { method: "POST", body });
  if (!res.ok) throw await refusalFrom(res, "Failed to upload photo");
  const data = (await res.json()) as { photo: ReceiptPhotoView };
  return data.photo;
};

const fetchReceiptPhotoInfo = async (photoId: string): Promise<ReceiptPhotoInfo> => {
  const res = await fetch(`${receiptPhotoUrl(photoId)}/info`);
  if (!res.ok) throw await refusalFrom(res, "Failed to load photo details");
  return (await res.json()) as ReceiptPhotoInfo;
};

/** Photo metadata and the transactions it is attached to. Disabled while `photoId` is null. */
export function useReceiptPhotoInfo(photoId: string | null) {
  return useQuery({
    queryKey: receiptPhotoKeys.info(photoId),
    queryFn: () => fetchReceiptPhotoInfo(photoId as string),
    enabled: photoId !== null,
  });
}
