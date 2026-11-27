"use client";

import { ImageOff, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useImageLoadState } from "@/hooks/use-image-load-state";
import { PhotoRevealCover, usePhotoReveal } from "@/components/transactions/receipt-photo-reveal";

interface ReceiptPhotoStripProps {
  /** `receiptPhotoUrl(id)` for a saved photo, or an object URL for one chosen but not yet saved. */
  src: string;
  /** Opens the full-screen viewer. Without it the strip is a preview only. */
  onOpen?: () => void;
  /** Width and edge bleed come from the caller, which knows the padding it sits in. */
  className?: string;
}

/**
 * Below `lg`: a 150px strip of the photo above the form. Too small to read on its own, which
 * is why it offers to open the photo full screen when the caller provides a viewer. Blurred
 * while amounts are hidden; the first tap reveals it, and only a later one opens the viewer.
 * Pulses while the photo loads and fades it in, as the desktop panel does: an AVIF appears only
 * once fully decoded, so without it a slow connection shows an empty box.
 */
export function ReceiptPhotoStrip({ src, onOpen, className }: ReceiptPhotoStripProps) {
  const image = useImageLoadState(src);
  const { blurred, reveal } = usePhotoReveal();

  return (
    <div className={cn("relative block h-[150px] overflow-hidden bg-[#3a3125]", className)}>
      {image.status === "loading" && <div className="absolute inset-0 animate-pulse bg-white/5" />}
      {image.status === "error" ? (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-cream-300">
          <ImageOff className="h-5 w-5" aria-hidden="true" />
          The photo couldn&apos;t load.
        </div>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- owner-checked bytes or a local object URL, neither of which next/image can optimise */}
          <img
            ref={image.ref}
            src={src}
            alt="Receipt photo"
            onLoad={image.onLoad}
            onError={image.onError}
            className={cn(
              "h-full w-full object-cover object-top transition-opacity duration-200 motion-reduce:transition-none",
              image.status === "loaded" ? "opacity-100" : "opacity-0",
              blurred && "blur-md",
            )}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-warm-900/35" />
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              aria-label="Open receipt photo"
              className="absolute inset-0 flex items-end justify-end p-2.5"
            >
              {!blurred && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warm-900/70 px-2.5 py-1 text-[11px] text-cream-50">
                  <Maximize2 className="h-3 w-3" aria-hidden="true" />
                  Tap to open
                </span>
              )}
            </button>
          )}
          {blurred && <PhotoRevealCover onReveal={reveal} />}
        </>
      )}
    </div>
  );
}
