"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { Expand, ImageOff, Maximize, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  clampPan,
  keyboardPan,
  panBounds,
  type PanBounds,
} from "@/components/transactions/receipt-photo-pan";
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
  // Read by the resize observer, which is set up once and must see the current zoom.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [bounds, setBounds] = useState<PanBounds>(() => panBounds(0, 0, MIN_ZOOM));
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // A resize changes the limits too (a window narrowed, the viewport height moving), so the same
  // pull-back runs then; otherwise a zoomed photo could sit past its frame until the next drag.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const nextBounds = panBounds(frame.clientWidth, frame.clientHeight, zoomRef.current);
      const inside = clampPan(x.get(), y.get(), nextBounds);
      setBounds(nextBounds);
      // `jump`, not `set`: a zoom step may still be animating the offset, and `set` leaves that
      // animation running to write its old target back over the clamp, past the new edge.
      x.jump(inside.x);
      y.jump(inside.y);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [x, y]);

  const onPanKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (zoom <= MIN_ZOOM) return;
    const next = keyboardPan(event.key, x.get(), y.get(), bounds);
    if (!next) return;
    event.preventDefault();
    // Not animated: each press must start from where the last one ended, and an animation still
    // running would hand a held key its mid-flight value and swallow most of each step. `jump`,
    // not `set`, for the same reason as the resize clamp: a zoom step still animating the offset
    // would otherwise land on its old target afterwards and undo the press.
    x.jump(next.x);
    y.jump(next.y);
  };

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
      <div
        ref={frameRef}
        // Focusable only while zoomed, when there is something to move: arrow keys pan it.
        tabIndex={zoom > MIN_ZOOM ? 0 : -1}
        role={zoom > MIN_ZOOM ? "group" : undefined}
        aria-label={zoom > MIN_ZOOM ? "Zoomed receipt photo. Use the arrow keys to move it." : undefined}
        onKeyDown={onPanKey}
        className="group relative flex-1 overflow-hidden bg-[#3a3125] focus-visible:outline-none"
      >
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
        {/* The focus ring, drawn above the image: an outline or ring on the frame itself sits
            underneath a zoomed photo that fills it, so a keyboard user saw no focus at all. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden ring-[3px] ring-inset ring-amber-dark group-focus-visible:block"
        />
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
