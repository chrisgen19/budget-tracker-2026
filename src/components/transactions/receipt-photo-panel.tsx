"use client";

import { useRef, useState } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { Expand, ImageOff, Maximize, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { clampPan, panBounds, type PanBounds } from "@/components/transactions/receipt-photo-pan";
import { PhotoRevealCover, usePhotoReveal } from "@/components/transactions/receipt-photo-reveal";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

interface ReceiptPhotoPanelProps {
  /** `receiptPhotoUrl(id)` for a saved photo, or an object URL for one chosen but not yet saved. */
  src: string;
  /** Categories of the other transactions sharing this photo. */
  sharedWith?: string[];
  /** Opens the full-screen viewer; offered only for a stored photo. */
  onOpen?: () => void;
  className?: string;
}

/** A small control with a 44px hit area drawn by a pseudo-element, so the bar stays compact. */
const zoomButtonClass =
  "relative grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-cream-100 transition-colors hover:bg-white/20 disabled:opacity-40 before:absolute before:-inset-1.5 before:content-['']";

/**
 * Desktop pane beside the form: the photo, zoomed with a CSS transform and dragged with the
 * pointer once zoomed in, so a date or total can be read against the fields at the same time.
 */
export function ReceiptPhotoPanel({ src, sharedWith, onOpen, className }: ReceiptPhotoPanelProps) {
  const { blurred, reveal } = usePhotoReveal();
  const frameRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [bounds, setBounds] = useState<PanBounds>(() => panBounds(0, 0, MIN_ZOOM));
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Bounds follow the zoom, and an offset left past the new edge (3x to 2x) is pulled back in.
  const setZoomTo = (next: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const frame = frameRef.current;
    const nextBounds = panBounds(frame?.clientWidth ?? 0, frame?.clientHeight ?? 0, clamped);
    const inside = clampPan(x.get(), y.get(), nextBounds);
    setZoom(clamped);
    setBounds(nextBounds);
    animate(x, inside.x);
    animate(y, inside.y);
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
            dragConstraints={bounds}
            dragElastic={0.1}
            dragMomentum={false}
            animate={{ scale: zoom }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{ x, y }}
            className={cn(
              "h-full w-full select-none object-contain",
              blurred && "blur-md",
              zoom > MIN_ZOOM ? "cursor-grab active:cursor-grabbing" : "cursor-default",
            )}
          />
        )}
        {blurred && status !== "error" && <PhotoRevealCover onReveal={reveal} />}
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
          {onOpen && (
            <button type="button" aria-label="Open full screen" onClick={onOpen} className={zoomButtonClass}>
              <Expand className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
