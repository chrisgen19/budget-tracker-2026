"use client";

import { useState } from "react";
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
 */
export function TransactionPhotoLayout({ photoSrc, ...rest }: TransactionPhotoLayoutProps) {
  if (!photoSrc) return <>{rest.children}</>;
  return <PhotoLayout photoSrc={photoSrc} {...rest} />;
}

/** Split out so a form with no photo never mounts the info query (or needs a QueryClient). */
function PhotoLayout({
  photoSrc,
  photoId = null,
  transactionId,
  onReplacePhoto,
  children,
}: TransactionPhotoLayoutProps & { photoSrc: string }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const storedId = photoId;
  const info = useReceiptPhotoInfo(storedId);

  const sharedWith = info.data?.transactions
    .filter((t) => t.id !== transactionId)
    .map((t) => t.categoryName);
  const openViewer = storedId ? () => setViewerOpen(true) : undefined;
  const replace = onReplacePhoto
    ? () => {
        setViewerOpen(false);
        onReplacePhoto();
      }
    : undefined;

  return (
    <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6">
      {/* Keyed by src so a replaced photo starts from its own loading state, not the old one's. */}
      <ReceiptPhotoPanel
        key={`panel-${photoSrc}`}
        src={photoSrc}
        sharedWith={storedId ? sharedWith : undefined}
        onOpen={openViewer}
        className="hidden lg:sticky lg:top-0 lg:flex lg:h-[min(560px,calc(85vh-9rem))]"
      />
      <div className="min-w-0">
        <ReceiptPhotoStrip
          key={`strip-${photoSrc}`}
          src={photoSrc}
          onOpen={openViewer}
          className="-mx-6 -mt-6 mb-6 w-[calc(100%+3rem)] lg:hidden"
        />
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
