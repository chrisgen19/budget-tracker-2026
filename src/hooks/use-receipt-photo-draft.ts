import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { HEIC_UNSUPPORTED_FIELD_MESSAGE, isHeicFile } from "@/lib/heic";
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
  const { showToast } = useToast();

  useEffect(() => {
    if (!pending) return;
    return () => URL.revokeObjectURL(pending.previewUrl);
  }, [pending]);

  const choose = useCallback(
    async (chosen: File) => {
      // A file the browser cannot decode comes back as chosen; the server has the last word on it.
      const file = await compressImage(chosen).catch(() => chosen);
      // Desktop Chrome and Firefox cannot convert HEIC, and the server cannot decode it either.
      if (isHeicFile(file)) {
        showToast(HEIC_UNSUPPORTED_FIELD_MESSAGE, "error");
        return;
      }
      setPending({ file, previewUrl: URL.createObjectURL(file), photoKey: crypto.randomUUID() });
    },
    [showToast],
  );

  const remove = useCallback(() => {
    setPending(null);
    setRemovedInitial(true);
  }, []);

  const shownInitialId = initialPhotoId && !removedInitial ? initialPhotoId : null;
  const src = pending?.previewUrl ?? (shownInitialId ? receiptPhotoUrl(shownInitialId) : null);

  const resolveForSubmit = useCallback(async (): Promise<ReceiptPhotoSubmit> => {
    // Removed on purpose stays removed. Without a Remove, omitting the key keeps the stored link,
    // so a plain Replace that fails to upload leaves the old photo where it was.
    const unlinked: ReceiptPhotoSubmit["patch"] = initialPhotoId && removedInitial ? { receiptPhotoId: null } : {};
    const chosen = pending;
    if (chosen) {
      try {
        const uploaded = await uploadReceiptPhoto(chosen.file, chosen.photoKey);
        return { patch: { receiptPhotoId: uploaded.id }, uploadFailed: false };
      } catch {
        return { patch: unlinked, uploadFailed: true };
      }
    }
    return { patch: unlinked, uploadFailed: false };
  }, [pending, initialPhotoId, removedInitial]);

  // Only a stored photo has an id: a chosen file is a local preview until submit uploads it.
  const photoId = pending ? null : shownInitialId;

  return { src, photoId, hasPhoto: src !== null, choose, remove, resolveForSubmit };
}
