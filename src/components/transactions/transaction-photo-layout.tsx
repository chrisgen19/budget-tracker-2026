"use client";

import { ReceiptPhotoPanel } from "@/components/transactions/receipt-photo-panel";
import { ReceiptPhotoStrip } from "@/components/transactions/receipt-photo-strip";

interface TransactionPhotoLayoutProps {
  /** The photo to show beside the form, or null for today's single-column layout. */
  photoSrc: string | null;
  sharedWith?: string[];
  onOpenPhoto?: () => void;
  children: React.ReactNode;
}

/**
 * Option C: at `lg` and up the photo sits left of the fields (the caller widens the Modal to
 * `size="wide"`); below `lg` it is a 150px strip bled to the sheet's edges above the form.
 * Lives with the form rather than the pages, so a page only has to pass the modal size.
 * The negative margins undo the Modal content's `p-6`.
 */
export function TransactionPhotoLayout({ photoSrc, sharedWith, onOpenPhoto, children }: TransactionPhotoLayoutProps) {
  if (!photoSrc) return <>{children}</>;

  return (
    <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6">
      {/* Keyed by src so a replaced photo starts from its own loading state, not the old one's. */}
      <ReceiptPhotoPanel
        key={`panel-${photoSrc}`}
        src={photoSrc}
        sharedWith={sharedWith}
        className="hidden lg:sticky lg:top-0 lg:flex lg:h-[min(560px,calc(85vh-9rem))]"
      />
      <div className="min-w-0">
        <ReceiptPhotoStrip
          key={`strip-${photoSrc}`}
          src={photoSrc}
          onOpen={onOpenPhoto}
          className="-mx-6 -mt-6 mb-6 w-[calc(100%+3rem)] lg:hidden"
        />
        {children}
      </div>
    </div>
  );
}
