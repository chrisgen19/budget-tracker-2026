"use client";

import { useRef, useState } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { ImageOff, Maximize, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

interface ReceiptPhotoPanelProps {
  /** `receiptPhotoUrl(id)` for a saved photo, or an object URL for one chosen but not yet saved. */
  src: string;
  /** Categories of the other transactions sharing this photo (filled by the viewer task). */
  sharedWith?: string[];
  className?: string;
}

/** A small control with a 44px hit area drawn by a pseudo-element, so the bar stays compact. */
const zoomButtonClass =
  "relative grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-cream-100 transition-colors hover:bg-white/20 disabled:opacity-40 before:absolute before:-inset-1.5 before:content-['']";

/**
 * Desktop pane beside the form: the photo, zoomed with a CSS transform and dragged with the
 * pointer once zoomed in, so a date or total can be read against the fields at the same time.
 */
export function ReceiptPhotoPanel({ src, sharedWith, className }: ReceiptPhotoPanelProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const setZoomTo = (next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setZoom(clamped);
    if (clamped === MIN_ZOOM) {
      animate(x, 0);
      animate(y, 0);
    }
  };

  return (
    <div className={cn("flex-col overflow-hidden rounded-2xl bg-warm-700", className)}>
      <div ref={frameRef} className="relative flex-1 overflow-hidden bg-[#3a3125]">
        {status === "loading" && <div className="absolute inset-0 animate-pulse bg-white/5" />}
        {status === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-cream-300">
            <ImageOff className="h-6 w-6" aria-hidden="true" />
            The photo couldn&apos;t load.
          </div>
        ) : (
          <motion.img
            key={src}
            src={src}
            alt="Receipt photo"
            draggable={false}
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("error")}
            drag={zoom > MIN_ZOOM}
            dragConstraints={frameRef}
            dragElastic={0.1}
            dragMomentum={false}
            animate={{ scale: zoom }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{ x, y }}
            className={cn(
              "h-full w-full select-none object-contain",
              zoom > MIN_ZOOM ? "cursor-grab active:cursor-grabbing" : "cursor-default",
            )}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-cream-300">
        <span className="min-w-0 truncate">
          {sharedWith && sharedWith.length > 0 ? `Also on ${sharedWith.join(", ")}` : null}
        </span>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoom <= MIN_ZOOM || status !== "loaded"}
            onClick={() => setZoomTo(zoom - ZOOM_STEP)}
            className={zoomButtonClass}
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoom >= MAX_ZOOM || status !== "loaded"}
            onClick={() => setZoomTo(zoom + ZOOM_STEP)}
            className={zoomButtonClass}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Fit photo"
            disabled={status !== "loaded"}
            onClick={() => setZoomTo(MIN_ZOOM)}
            className={zoomButtonClass}
          >
            <Maximize className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
