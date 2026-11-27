"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReceiptPhotoZoom } from "@/hooks/use-receipt-photo-zoom";
import { useImageLoadState } from "@/hooks/use-image-load-state";
import { PhotoRevealCover } from "@/components/transactions/receipt-photo-reveal";

interface ReceiptPhotoZoomFrameProps {
  src: string;
  blurred: boolean;
  onReveal: () => void;
}

/**
 * The viewer's photo: pinch or wheel to zoom, drag to pan. Its own component so the zoom hook
 * mounts with the frame it measures. While blurred the gestures are off, so a pointer capture
 * cannot retarget the click meant for the reveal cover. Pulses while the photo loads and fades
 * it in, matching the desktop panel; zooming waits for the photo, since there is nothing to move.
 */
export function ReceiptPhotoZoomFrame({ src, blurred, onReveal }: ReceiptPhotoZoomFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const image = useImageLoadState(src);
  const failed = image.status === "error";
  const ready = image.status === "loaded";
  const { zoomed, style, handlers } = useReceiptPhotoZoom(frameRef, ready && !blurred);

  return (
    <div
      ref={frameRef}
      className="relative min-h-0 flex-1 touch-none overflow-hidden"
      {...(ready && !blurred ? handlers : {})}
    >
      {image.status === "loading" && <div className="absolute inset-0 animate-pulse bg-white/5" />}
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-cream-300">
          <ImageOff className="h-6 w-6" aria-hidden="true" />
          The photo couldn&apos;t load.
        </div>
      ) : (
        <motion.img
          src={src}
          alt="Receipt photo"
          ref={image.ref}
          draggable={false}
          onLoad={image.onLoad}
          onError={image.onError}
          style={style}
          className={cn(
            "h-full w-full select-none object-contain transition-opacity duration-200 motion-reduce:transition-none",
            ready ? "opacity-100" : "opacity-0",
            zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
            blurred && "blur-md",
          )}
        />
      )}
      {blurred && !failed && <PhotoRevealCover onReveal={onReveal} />}
    </div>
  );
}
