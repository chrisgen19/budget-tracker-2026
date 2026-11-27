"use client";

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Download, RefreshCw, X } from "lucide-react";
import { receiptPhotoUrl, useReceiptPhotoInfo } from "@/hooks/use-receipt-photos";
import { useDialogLifecycle } from "@/components/ui/use-dialog-lifecycle";
import { usePhotoReveal } from "@/components/transactions/receipt-photo-reveal";
import { ReceiptPhotoZoomFrame } from "@/components/transactions/receipt-photo-zoom-frame";
import { ReceiptPhotoLinkedRows } from "@/components/transactions/receipt-photo-linked-rows";

interface ReceiptPhotoViewerProps {
  open: boolean;
  /** A stored photo. A file chosen but not yet uploaded has no id, and is not offered here. */
  photoId: string;
  onClose: () => void;
  /** Opens the caller's file picker. Replace renders only when this is provided (ruling R5). */
  onReplace?: () => void;
}

const actionClass =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-cream-200 px-3 text-[13px] font-medium text-warm-600 transition-colors hover:bg-cream-300";

/** "2026-11-26" to "Nov 26". A calendar day, so it is formatted in UTC and never shifts. */
const shortDay = (localDate: string) =>
  new Date(`${localDate}T00:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The receipt full screen, over everything including an open Modal. Portalled for the same
 * reason Modal is: a transformed ancestor would otherwise become the containing block of its
 * `fixed inset-0`. Mounted only while open, so closing unmounts it and the zoom starts afresh.
 */
export function ReceiptPhotoViewer({ open, ...props }: ReceiptPhotoViewerProps) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<ViewerDialog {...props} />, document.body);
}

function ViewerDialog({ photoId, onClose, onReplace }: Omit<ReceiptPhotoViewerProps, "open">) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogLifecycle(true, dialogRef, closeRef, onClose);
  const info = useReceiptPhotoInfo(photoId);
  const { blurred, reveal } = usePhotoReveal();
  const day = info.data?.transactions[0]?.localDate;

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] flex flex-col bg-[#13100B] outline-none"
    >
      <div className="flex shrink-0 items-center justify-between px-2 py-1 text-cream-100">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close receipt photo"
          className="grid h-11 w-11 place-items-center rounded-xl transition-colors hover:bg-white/10"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <h2 id={titleId} className="text-sm">
          {day ? `Receipt · ${shortDay(day)}` : "Receipt"}
        </h2>
        <span className="h-11 w-11" aria-hidden="true" />
      </div>

      <ReceiptPhotoZoomFrame src={receiptPhotoUrl(photoId)} blurred={blurred} onReveal={reveal} />

      <div className="shrink-0 rounded-t-[20px] bg-cream-50/[.97] px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:mx-auto sm:mb-4 sm:w-full sm:max-w-md sm:rounded-[20px]">
        <ReceiptPhotoLinkedRows data={info.data} isLoading={info.isLoading} isError={info.isError} />
        <div className="mt-3 flex gap-2">
          <a href={receiptPhotoUrl(photoId)} download={`receipt-${day ?? photoId}.jpg`} className={actionClass}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download
          </a>
          {onReplace && (
            <button type="button" onClick={onReplace} className={actionClass}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Replace
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
