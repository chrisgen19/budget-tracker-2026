import { useCallback, useEffect, useState } from "react";
import { compressImage } from "@/lib/utils";
import { receiptPhotoUrl, uploadReceiptPhoto } from "@/hooks/use-receipt-photos";

/** What a submit should add to the payload, and whether a chosen photo failed to upload. */
export interface ReceiptPhotoSubmit {
  /** Spread into the payload: empty when nothing changed, so the server keeps the stored link. */
  patch: { receiptPhotoId?: string | null };
  uploadFailed: boolean;
}

interface PendingPhoto {
  file: File;
  previewUrl: string;
  /** Generated once per chosen file, so pressing Save again replays rather than storing twice. */
  photoKey: string;
}

/**
 * The receipt photo a transaction form is editing: the stored one, a newly chosen local file,
 * or none. A chosen file stays local until submit (ruling R4), so cancelling uploads nothing.
 */
export function useReceiptPhotoDraft(initialPhotoId: string | null) {
  const [removedInitial, setRemovedInitial] = useState(false);
  const [pending, setPending] = useState<PendingPhoto | null>(null);

  useEffect(() => {
    if (!pending) return;
    return () => URL.revokeObjectURL(pending.previewUrl);
  }, [pending]);

  const choose = useCallback((file: File) => {
    setPending({ file, previewUrl: URL.createObjectURL(file), photoKey: crypto.randomUUID() });
  }, []);

  const remove = useCallback(() => {
    setPending(null);
    setRemovedInitial(true);
  }, []);

  const shownInitialId = initialPhotoId && !removedInitial ? initialPhotoId : null;
  const src = pending?.previewUrl ?? (shownInitialId ? receiptPhotoUrl(shownInitialId) : null);

  const resolveForSubmit = useCallback(async (): Promise<ReceiptPhotoSubmit> => {
    const chosen = pending;
    if (chosen) {
      try {
        // A file the browser cannot decode is sent as chosen; the server has the last word on it.
        const file = await compressImage(chosen.file).catch(() => chosen.file);
        const uploaded = await uploadReceiptPhoto(file, chosen.photoKey);
        return { patch: { receiptPhotoId: uploaded.id }, uploadFailed: false };
      } catch {
        return { patch: {}, uploadFailed: true };
      }
    }
    if (initialPhotoId && removedInitial) return { patch: { receiptPhotoId: null }, uploadFailed: false };
    return { patch: {}, uploadFailed: false };
  }, [pending, initialPhotoId, removedInitial]);

  return { src, hasPhoto: src !== null, choose, remove, resolveForSubmit };
}
