"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { compressImage, formatDateInput, toLocalDateString } from "@/lib/utils";
import { useUser } from "@/components/user-provider";
import { useToast } from "@/components/ui/toast";
import { BatchSaveError, useBatchCreateTransactions } from "@/hooks/use-transactions";
import { MAX_BATCH_TRANSACTIONS } from "@/lib/validations";
import type { MultiScanItem } from "@/types";

/** Parallel scan requests in flight. */
const CONCURRENCY = 3;

type ScanData = NonNullable<MultiScanItem["data"]>;
type ScanBreakdown = NonNullable<ScanData["breakdown"]>;

/** Take a date string from Gemini (YYYY-MM-DD or YYYY-MM-DDTHH:mm) and
 *  replace the time portion with the user's current local time. */
const withLocalTime = (dateStr: string): string => {
  const dateOnly = dateStr.slice(0, 10);
  return formatDateInput(new Date(dateOnly + "T" + new Date().toTimeString().slice(0, 5)));
};

/** Read a JSON body without throwing. An error response is not guaranteed to be JSON —
 *  an unhandled server fault returns HTML, and letting `res.json()` reject there would
 *  report every such failure to the user as a network problem. */
const readJson = async (res: Response): Promise<Record<string, unknown>> => {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const errorFrom = (body: Record<string, unknown>, fallback: string): string =>
  typeof body.error === "string" ? body.error : fallback;

interface ScanInput {
  itemId: string;
  file: File;
  photoDate: string;
  photoDateTime: string;
}

/** Outcome of one scan. Returned rather than read back from item state: `patchItem` only
 *  schedules a render, so a caller awaiting `scanOne` would still see the stale row. */
type ScanOutcome = { ok: true } | { ok: false; error: string };

/**
 * Orchestrates receipt scanning: capture, the review queue, itemisation, retrying a failed
 * row, and the atomic save. Extracted from AppShell, which had grown past 750 lines with
 * all of this inline.
 */
export function useMultiScan() {
  const { setUser } = useUser();
  const { showToast } = useToast();
  const batchCreateMutation = useBatchCreateTransactions();

  const [items, setItems] = useState<MultiScanItem[]>([]);
  const [showReview, setShowReview] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isSavingAll, setIsSavingAll] = useState(false);
  // Read by the queue-mutation guards, which must see the in-flight save immediately
  // rather than a render later.
  const savingRef = useRef(false);

  // An unacknowledged batch save: the idempotency key together with the exact rows it was
  // sent with. Held across a failure so a retry is a replay rather than a second insert —
  // a batch can commit and still lose its response, and the failure toast invites a retry.
  //
  // The rows are pinned, not rebuilt from the queue, because the two must agree. The server
  // replays whatever the key already created, so resending a *grown* payload under the same
  // key would return only the original rows while the client marked the additions saved,
  // dropping them silently. Cleared once a save is acknowledged.
  const pendingSaveRef = useRef<{ key: string; items: MultiScanItem[] } | null>(null);

  // Ids of rows sitting in an unacknowledged batch. Mirrored into state so the review can
  // stop offering edits that a replay would silently ignore.
  const [unconfirmedIds, setUnconfirmedIds] = useState<ReadonlySet<string>>(new Set());

  // Mirrors `items` so callbacks can read the current queue without being re-created on
  // every state change, and so retry never closes over a stale array. Synced after commit
  // rather than during render: React may discard a render, and a ref written in one would
  // leak a queue that was never committed. Every reader runs from a user event, after commit.
  const itemsRef = useRef<MultiScanItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const patchItem = useCallback((id: string, patch: Partial<MultiScanItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  /** A 403 means the server-side allowance is gone; mirror that locally so the remaining
   *  count stops disagreeing with what the API will actually accept. */
  const syncQuotaExhausted = useCallback(() => {
    setUser((prev) =>
      prev.monthlyScanLimit > 0 ? { scansUsedThisMonth: prev.monthlyScanLimit } : {},
    );
  }, [setUser]);

  /** Scan one already-compressed image and fold the outcome into its row. */
  const scanOne = useCallback(
    async ({ itemId, file, photoDate, photoDateTime }: ScanInput): Promise<ScanOutcome> => {
      patchItem(itemId, { status: "scanning", error: undefined });

      try {
        const formData = new FormData();
        formData.append("receipt", file);
        formData.append("localDate", toLocalDateString(new Date()));
        formData.append("photoDate", photoDate);

        const res = await fetch("/api/receipts/scan", { method: "POST", body: formData });
        const data = await readJson(res);

        if (!res.ok) {
          // Not every 403 is a spent allowance: the feature can be off for the user or
          // their role. Mirroring those as "no scans remaining" is both wrong and sticky.
          if (data.code === "LIMIT_REACHED") syncQuotaExhausted();
          const error = errorFrom(data, "Failed to scan receipt.");
          patchItem(itemId, { status: "error", error });
          return { ok: false, error };
        }

        // The server validates its own response with Zod, so this only fires on a version
        // skew or a mangled 200. Worth catching: an unvalidated row reaches saveAll, which
        // asserts these fields non-null, and the server then rejects the whole atomic batch
        // with "Invalid input" — the batch-wide failure this change exists to remove. As a
        // per-row error it is retryable instead. It also stops `withLocalTime(undefined)`
        // throwing on `.slice` and being reported as a network problem.
        if (
          typeof data.amount !== "number" ||
          typeof data.categoryId !== "string" ||
          (!data.usedPhotoFallback && typeof data.date !== "string")
        ) {
          const error = "The scan returned an unexpected result. Please try again.";
          patchItem(itemId, { status: "error", error });
          return { ok: false, error };
        }

        patchItem(itemId, {
          status: "success",
          error: undefined,
          data: {
            amount: data.amount,
            description: typeof data.description === "string" ? data.description : "",
            type: "EXPENSE",
            date: data.usedPhotoFallback ? photoDateTime : withLocalTime(data.date as string),
            categoryId: data.categoryId,
            multiCategory: data.multiCategory as boolean,
            breakdownDropped: data.breakdownDropped as boolean | undefined,
            breakdown: data.breakdown as ScanBreakdown | undefined,
            dateWarning: data.dateWarning as boolean,
          },
        });

        setUser((prev) => ({ scansUsedThisMonth: prev.scansUsedThisMonth + 1 }));
        return { ok: true };
      } catch {
        const error = "Network error. Please check your connection and try again.";
        patchItem(itemId, { status: "error", error });
        return { ok: false, error };
      }
    },
    [patchItem, setUser, syncQuotaExhausted],
  );

  /** Single capture from the camera. Drives the scan sheet's own loading and error state.
   *  Resolves true when the scan succeeded; the caller opens the review modal, so that
   *  closing the sheet and opening the review batch into one render. Splitting them leaves
   *  both modals mounted for a frame, and the sheet's unmount cleanup then restores
   *  `body.overflow`, dropping the review modal's scroll lock. */
  const scanSingle = useCallback(
    async (file: File): Promise<boolean> => {
      setIsScanning(true);
      setScanError(null);

      // Capture the photo timestamp before compression — canvas re-encoding loses metadata.
      const photoMoment = file.lastModified ? new Date(file.lastModified) : new Date();
      const photoDate = toLocalDateString(photoMoment);
      const photoDateTime = formatDateInput(photoMoment);

      let compressed: File;
      try {
        compressed = await compressImage(file);
      } catch {
        // Distinct from a network failure: the image never left the device.
        setScanError("That image could not be read. Please try a different photo.");
        setIsScanning(false);
        return false;
      }

      const itemId = `${Date.now()}-single`;
      setItems([
        {
          id: itemId,
          fileName: file.name,
          status: "scanning",
          imageFile: compressed,
          photoDate,
          photoDateTime,
        },
      ]);

      const outcome = await scanOne({ itemId, file: compressed, photoDate, photoDateTime });
      setIsScanning(false);

      // Keep the sheet open on failure so the error sits next to the buttons that retry it.
      if (!outcome.ok) {
        setScanError(outcome.error);
        setItems([]);
        return false;
      }

      return true;
    },
    [scanOne],
  );

  /** Batch upload. Compression runs in parallel; uploads start as each file finishes. */
  const scanMultiple = useCallback(
    async (files: File[]) => {
      setScanError(null);

      const photoMoments = files.map((f) =>
        f.lastModified ? new Date(f.lastModified) : new Date(),
      );
      const photoDates = photoMoments.map(toLocalDateString);
      const photoDateTimes = photoMoments.map(formatDateInput);

      const initialItems: MultiScanItem[] = files.map((f, i) => ({
        id: `${Date.now()}-${i}`,
        fileName: f.name,
        status: "scanning",
        photoDate: photoDates[i],
        photoDateTime: photoDateTimes[i],
      }));

      setItems(initialItems);
      setShowReview(true);

      // Compression is local and free, so it never blocks on the upload queue. A rejection
      // is reported on the row rather than uploading the original: an unreadable original
      // usually trips the server's 4 MB limit, which reports a misleading cause. This
      // matches what scanSingle already does. HEIC is unaffected — compressImage resolves
      // with the original there rather than rejecting, since Gemini accepts HEIC directly.
      const compressedPromises = files.map((f) =>
        compressImage(f).then(
          (compressed) => ({ ok: true as const, file: compressed }),
          () => ({ ok: false as const }),
        ),
      );

      let nextIndex = 0;
      const processNext = async (): Promise<void> => {
        while (nextIndex < compressedPromises.length) {
          const i = nextIndex++;
          const result = await compressedPromises[i];
          const itemId = initialItems[i].id;

          if (!result.ok) {
            // No imageFile, so this row is not offered a Retry: re-compressing the same
            // unreadable file would fail the same way.
            patchItem(itemId, {
              status: "error",
              error: "That image could not be read. Please try a different photo.",
            });
            continue;
          }

          // Held on the row so a failed scan can be retried without re-picking the file.
          patchItem(itemId, { imageFile: result.file });

          await scanOne({
            itemId,
            file: result.file,
            photoDate: photoDates[i],
            photoDateTime: photoDateTimes[i],
          });
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, compressedPromises.length) }, () =>
          processNext(),
        ),
      );
    },
    [patchItem, scanOne],
  );

  /** Re-run a failed scan. The credit for the failed attempt was refunded server-side. */
  const retryItem = useCallback(
    async (id: string) => {
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item?.imageFile) return;

      await scanOne({
        itemId: id,
        file: item.imageFile,
        photoDate: item.photoDate ?? toLocalDateString(new Date()),
        photoDateTime: item.photoDateTime ?? formatDateInput(new Date()),
      });
    },
    [scanOne],
  );

  /** Replace a multi-category receipt with one row per category. */
  const expandBreakdown = useCallback(
    (id: string, fileName: string, date: string, breakdown: ScanBreakdown, dateWarning?: boolean) => {
      const receiptGroupId = crypto.randomUUID();

      const children: MultiScanItem[] = breakdown.map((bi, idx) => ({
        id: `${id}-breakdown-${idx}`,
        fileName,
        status: "success",
        parentId: id,
        data: {
          amount: bi.amount,
          description: bi.description,
          type: "EXPENSE",
          date,
          categoryId: bi.categoryId,
          receiptGroupId,
          dateWarning,
          receiptBreakdown: {
            total: bi.amount,
            items: bi.lineItems.map((li) => ({ name: li.name, amount: li.amount })),
          },
        },
      }));

      setItems((prev) => {
        const index = prev.findIndex((i) => i.id === id);
        if (index === -1) return prev;
        const next = [...prev];
        next.splice(index, 1, ...children);
        return next;
      });
    },
    [],
  );

  /** Split a receipt by category, using the combined scan's breakdown when it has one. */
  const itemizeItem = useCallback(
    async (id: string) => {
      // Save All snapshots the rows it submits. Expanding a submitted parent into children
      // mid-flight leaves those children outside `savedIds`, so they survive the save and
      // the next one recreates the same expenses. The UI disables this too; the guard here
      // is what actually holds.
      if (savingRef.current || unconfirmedIds.has(id)) return;
      const item = itemsRef.current.find((i) => i.id === id);
      if (!item) return;

      // Already present from the combined scan: no second call, no extra credit.
      if (item.data?.breakdown?.length) {
        expandBreakdown(
          id,
          item.fileName,
          item.data.date ?? new Date().toISOString(),
          item.data.breakdown,
          item.data.dateWarning,
        );
        return;
      }

      if (!item.imageFile) return;
      patchItem(id, { status: "breaking_down" });

      try {
        const photoMoment = item.imageFile.lastModified
          ? new Date(item.imageFile.lastModified)
          : new Date();
        const photoDateTime = formatDateInput(photoMoment);

        const formData = new FormData();
        formData.append("receipt", item.imageFile);
        formData.append("localDate", toLocalDateString(new Date()));
        formData.append("photoDate", toLocalDateString(photoMoment));

        const res = await fetch("/api/receipts/breakdown", { method: "POST", body: formData });
        const data = await readJson(res);

        if (!res.ok) {
          if (data.code === "LIMIT_REACHED") syncQuotaExhausted();
          // Revert to success so the scanned row stays savable, and say why it failed.
          patchItem(id, { status: "success" });
          showToast(errorFrom(data, "Failed to itemize receipt. Please try again."), "error");
          return;
        }

        const finalDate = data.usedPhotoFallback
          ? photoDateTime
          : withLocalTime(data.date as string);

        expandBreakdown(
          id,
          item.fileName,
          finalDate,
          data.items as ScanBreakdown,
          data.dateWarning as boolean,
        );
        setUser((prev) => ({ scansUsedThisMonth: prev.scansUsedThisMonth + 1 }));
      } catch {
        patchItem(id, { status: "success" });
        showToast("Network error. Please check your connection and try again.", "error");
      }
    },
    [expandBreakdown, patchItem, setUser, showToast, syncQuotaExhausted, unconfirmedIds],
  );

  const isUnconfirmed = useCallback(
    (id: string) => unconfirmedIds.has(id),
    [unconfirmedIds],
  );

  const removeItem = useCallback(
    (id: string) => {
      if (savingRef.current || unconfirmedIds.has(id)) return;
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [unconfirmedIds],
  );

  const updateItem = useCallback(
    (id: string, data: ScanData) => {
      // An edit here would be silently discarded: the retry replays the pinned rows.
      if (savingRef.current || unconfirmedIds.has(id)) return;

      // Keys explicitly set to undefined are dropped rather than written over what is
      // already there. TransactionForm omits labelIds when the picker was not touched, so
      // a second edit of any other field would otherwise clear labels chosen in the first.
      // An explicit [] still writes: it means the user opted out, which is not the same as
      // never having chosen, and the server treats the two differently.
      const patch = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      ) as ScanData;

      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, data: { ...item.data, ...patch } } : item)),
      );
    },
    [unconfirmedIds],
  );

  const openReview = useCallback(() => setShowReview(true), []);

  const reset = useCallback(() => {
    pendingSaveRef.current = null;
    setUnconfirmedIds(new Set());
    setShowReview(false);
    setItems([]);
  }, []);

  /**
   * Save every reviewed row in one atomic request.
   *
   * A failure leaves the queue exactly as it was. It used to flip every row to `error`,
   * which stranded the data behind a UI that only offered deletion — losing the scan
   * credits along with the work, for what is usually a transient error.
   *
   * On success only the saved rows are removed. Rows that failed to scan keep their
   * retained image and stay in the review, because clearing the whole queue would throw
   * away the retry path for a mixed batch: save the three that worked and the two 503s
   * disappear with no way back to them short of re-picking the files.
   */
  const saveAll = useCallback(async () => {
    // A previous attempt that was never acknowledged is resent exactly as it went out,
    // rather than rebuilt from a queue the user may have added to since.
    const pending = pendingSaveRef.current;
    const submitItems =
      pending?.items ?? itemsRef.current.filter((i) => i.status === "success" && i.data);
    if (submitItems.length === 0) return;

    if (submitItems.length > MAX_BATCH_TRANSACTIONS) {
      showToast(
        `Too many transactions to save at once (${submitItems.length}). Remove some rows and keep it under ${MAX_BATCH_TRANSACTIONS}.`,
        "error",
      );
      return;
    }

    savingRef.current = true;
    setIsSavingAll(true);
    pendingSaveRef.current = pending ?? { key: crypto.randomUUID(), items: submitItems };

    try {
      await batchCreateMutation.mutateAsync({
        clientBatchId: pendingSaveRef.current.key,
        transactions: submitItems.map((item) => ({
          amount: item.data!.amount!,
          description: item.data!.description!,
          type: item.data!.type!,
          date: item.data!.date
            ? new Date(item.data!.date).toISOString()
            : new Date().toISOString(),
          categoryId: item.data!.categoryId!,
          ...(item.data!.labelIds !== undefined && { labelIds: item.data!.labelIds }),
          ...(item.data!.receiptGroupId && { receiptGroupId: item.data!.receiptGroupId }),
          ...(item.data!.receiptBreakdown && { receiptBreakdown: item.data!.receiptBreakdown }),
        })),
      });
    } catch (error) {
      // A definitive rejection wrote nothing, so the pin is dropped and the user's
      // corrections take effect on the next attempt as a fresh intent. Anything less
      // certain keeps the pin: the retry must replay these exact rows under the same key.
      const definitelyNotCommitted =
        error instanceof BatchSaveError && error.committed === "no";

      if (definitelyNotCommitted) {
        pendingSaveRef.current = null;
        setUnconfirmedIds(new Set());
        showToast("Could not save your receipts. Your scans are still here — try again.", "error");
      } else {
        setUnconfirmedIds(new Set(submitItems.map((i) => i.id)));
        showToast(
          "We could not confirm that save. Press Save again to finish it safely — it will not create duplicates.",
          "error",
        );
      }
      return;
    } finally {
      savingRef.current = false;
      setIsSavingAll(false);
    }

    // Acknowledged, so the next save is a new intent and needs its own key.
    pendingSaveRef.current = null;
    setUnconfirmedIds(new Set());

    // Only the rows actually submitted are removed. Anything added while the save was
    // unacknowledged is still unsaved and stays in the queue for the next attempt.
    const savedIds = new Set(submitItems.map((i) => i.id));
    const remaining = itemsRef.current.filter((i) => !savedIds.has(i.id));

    if (remaining.length === 0) {
      reset();
      return;
    }

    // Keep the review open on whatever is left — failed scans, and anything scanned after
    // this batch went out — so Retry and Save are both still reachable.
    setItems(remaining);
    const savable = remaining.filter((i) => i.status === "success" && i.data).length;
    showToast(
      savable > 0
        ? `Saved ${savedIds.size} transaction${savedIds.size === 1 ? "" : "s"}. ${savable} still to save.`
        : `Saved ${savedIds.size} transaction${savedIds.size === 1 ? "" : "s"}. ${remaining.length} receipt${remaining.length === 1 ? "" : "s"} still need attention.`,
    );
  }, [batchCreateMutation, reset, showToast]);

  /** True while any row is mid-flight; closing or saving must wait for these. */
  const isBusy = items.some((i) => i.status === "scanning" || i.status === "breaking_down");

  /** Scanned rows that would be discarded by closing without saving. */
  const unsavedCount = items.filter((i) => i.status === "success" && i.data).length;

  /** Failed rows that still hold their image and could be retried. Closing loses that,
   *  so it needs confirming too — worded separately, since the failed attempts were
   *  refunded and re-scanning them costs nothing but re-picking the files. */
  const retryableCount = items.filter((i) => i.status === "error" && i.imageFile).length;

  return {
    items,
    showReview,
    isScanning,
    scanError,
    isSavingAll,
    isBusy,
    unsavedCount,
    retryableCount,
    unconfirmedIds,
    isUnconfirmed,
    setScanError,
    scanSingle,
    scanMultiple,
    openReview,
    retryItem,
    itemizeItem,
    removeItem,
    updateItem,
    saveAll,
    reset,
  };
}
