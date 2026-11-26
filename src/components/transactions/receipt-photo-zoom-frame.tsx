"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReceiptPhotoZoom } from "@/hooks/use-receipt-photo-zoom";
import { PhotoRevealCover } from "@/components/transactions/receipt-photo-reveal";

interface ReceiptPhotoZoomFrameProps {
  src: string;
  blurred: boolean;
  onReveal: () => void;
}

/**
 * The viewer's photo: pinch or wheel to zoom, drag to pan. Its own component so the zoom hook
 * mounts with the frame it measures. While blurred the gestures are off, so a pointer capture
 * cannot retarget the click meant for the reveal cover.
 */
export function ReceiptPhotoZoomFrame({ src, blurred, onReveal }: ReceiptPhotoZoomFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const { zoomed, style, handlers } = useReceiptPhotoZoom(frameRef);

  return (
    <div
      ref={frameRef}
      className="relative min-h-0 flex-1 touch-none overflow-hidden"
      {...(blurred || failed ? {} : handlers)}
    >
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-cream-300">
          <ImageOff className="h-6 w-6" aria-hidden="true" />
          The photo couldn&apos;t load.
        </div>
      ) : (
        <motion.img
          src={src}
          alt="Receipt photo"
          draggable={false}
          onError={() => setFailed(true)}
          style={style}
          className={cn(
            "h-full w-full select-none object-contain",
            zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
            blurred && "blur-md",
          )}
        />
      )}
      {blurred && !failed && <PhotoRevealCover onReveal={onReveal} />}
    </div>
  );
}
