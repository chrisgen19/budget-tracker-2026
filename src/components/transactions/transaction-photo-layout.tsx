"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ReceiptPhotoPanel } from "@/components/transactions/receipt-photo-panel";
import { ReceiptPhotoStrip } from "@/components/transactions/receipt-photo-strip";
import { ReceiptPhotoViewer } from "@/components/transactions/receipt-photo-viewer";
import { useReceiptPhotoInfo } from "@/hooks/use-receipt-photos";

interface TransactionPhotoLayoutProps {
  /** The photo to show beside the form, or null for today's single-column layout. */
  photoSrc: string | null;
  /**
   * The stored photo's id, or null for none or a local file not yet uploaded. Only a stored
   * photo opens the full-screen viewer: a local one has no linked rows to list and no URL to
   * download, so the strip and panel show its preview and offer nothing more.
   */
  photoId?: string | null;
  /** The transaction being edited, left out of "Also on". */
  transactionId?: string;
  /** Opens the form's own file picker, from the viewer's Replace. */
  onReplacePhoto?: () => void;
  children: React.ReactNode;
}

/**
 * Option C: at `lg` and up the photo sits left of the fields (the caller widens the Modal to
 * `size="wide"`); below `lg` it is a 150px strip bled to the sheet's edges above the form.
 * Lives with the form rather than the pages, so a page only has to pass the modal size.
 * The negative margins undo the Modal content's `p-6`.
 *
 * The element tree is the same with or without a photo, and only the photo parts and the grid
 * classes switch. It used to return the children bare when there was no photo and wrapped when
 * there was, and that change of parent made React remount the whole form on attach and on
 * remove: local state reset and the amount field's autofocus fired again, popping a phone's
 * keyboard mid-edit.
 */
export function TransactionPhotoLayout({
  photoSrc,
  photoId = null,
  transactionId,
  onReplacePhoto,
  children,
}: TransactionPhotoLayoutProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const storedId = photoSrc ? photoId : null;
  const openViewer = storedId ? () => setViewerOpen(true) : undefined;
  const replace = onReplacePhoto
    ? () => {
        setViewerOpen(false);
        onReplacePhoto();
      }
    : undefined;

  return (
    <div className={cn(photoSrc && "lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6")}>
      {photoSrc && (
        <PanelWithInfo
          key={`panel-${photoSrc}`}
          src={photoSrc}
          storedId={storedId}
          transactionId={transactionId}
          onOpen={openViewer}
        />
      )}
      <div className={cn(photoSrc && "min-w-0")}>
        {/* Keyed by src so a replaced photo starts from its own loading state, not the old one's. */}
        {photoSrc && (
          <ReceiptPhotoStrip
            key={`strip-${photoSrc}`}
            src={photoSrc}
            onOpen={openViewer}
            className="-mx-6 -mt-6 mb-6 w-[calc(100%+3rem)] lg:hidden"
          />
        )}
        {children}
      </div>
      {storedId && (
        <ReceiptPhotoViewer
          open={viewerOpen}
          photoId={storedId}
          onClose={() => setViewerOpen(false)}
          onReplace={replace}
        />
      )}
    </div>
  );
}

/**
 * The desktop panel and the info query behind its "Also on" line. Split out so a form with no
 * photo never mounts the query (or needs a QueryClient).
 */
function PanelWithInfo({
  src,
  storedId,
  transactionId,
  onOpen,
}: {
  src: string;
  storedId: string | null;
  transactionId?: string;
  onOpen?: () => void;
}) {
  const info = useReceiptPhotoInfo(storedId);
  const sharedWith = info.data?.transactions
    .filter((t) => t.id !== transactionId)
    .map((t) => t.categoryName);
  return (
    <ReceiptPhotoPanel
      src={src}
      sharedWith={storedId ? sharedWith : undefined}
      onOpen={onOpen}
      className="hidden lg:sticky lg:top-0 lg:flex lg:h-[min(560px,calc(85vh-9rem))]"
    />
  );
}
