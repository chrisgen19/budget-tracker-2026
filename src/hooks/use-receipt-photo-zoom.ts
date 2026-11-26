import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { useMotionValue } from "framer-motion";
import { clampPan, panBounds } from "@/components/transactions/receipt-photo-pan";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
/** How strongly one wheel notch zooms; exponential so in and out are symmetric. */
const WHEEL_SENSITIVITY = 0.002;

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Pinch, wheel and drag zoom for the full-screen viewer, on raw pointer events rather than
 * framer-motion's `drag`: one finger pans and two pinch, and a drag gesture would claim the
 * first finger before the second arrives. Pan limits come from `panBounds`/`clampPan`, the
 * same rules as the desktop panel, so a zoomed photo can never be pushed off its frame.
 */
export function useReceiptPhotoZoom(frameRef: RefObject<HTMLElement | null>) {
  const [zoomed, setZoomed] = useState(false);
  const scale = useMotionValue(MIN_ZOOM);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  const moveTo = useCallback(
    (nextX: number, nextY: number, zoom: number) => {
      const frame = frameRef.current;
      const bounds = panBounds(frame?.clientWidth ?? 0, frame?.clientHeight ?? 0, zoom);
      const inside = clampPan(nextX, nextY, bounds);
      x.set(inside.x);
      y.set(inside.y);
    },
    [frameRef, x, y],
  );

  const zoomTo = useCallback(
    (next: number) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      scale.set(zoom);
      setZoomed(zoom > MIN_ZOOM);
      moveTo(x.get(), y.get(), zoom);
    },
    [moveTo, scale, x, y],
  );

  // Native and non-passive: React's wheel listener is passive, and a trackpad pinch arrives as
  // ctrl+wheel, which the browser would otherwise take as a page zoom.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomTo(scale.get() * Math.exp(-event.deltaY * WHEEL_SENSITIVITY));
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [frameRef, scale, zoomTo]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [a, b] = [...pointers.current.values()];
    if (a && b) pinch.current = { distance: distance(a, b), zoom: scale.get() };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, current);
    const [a, b] = [...pointers.current.values()];
    if (pinch.current && a && b && pinch.current.distance > 0) {
      zoomTo((pinch.current.zoom * distance(a, b)) / pinch.current.distance);
    } else if (pointers.current.size === 1 && scale.get() > MIN_ZOOM) {
      moveTo(x.get() + current.x - previous.x, y.get() + current.y - previous.y, scale.get());
    }
  };

  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  return {
    zoomed,
    style: { x, y, scale },
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
  };
}
