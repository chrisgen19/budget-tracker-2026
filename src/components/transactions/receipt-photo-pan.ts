/** How far a zoomed photo may be dragged, in px of the `x`/`y` motion values. */
export interface PanBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Pan limits for an image filling a `width` x `height` frame, scaled about its centre by `zoom`.
 * The scaled image overhangs the frame by `size * (zoom - 1) / 2` on each side, which is exactly
 * how far it can move before an edge comes inside the frame. At fit (1x) there is nothing to pan.
 *
 * Computed here rather than with `dragConstraints={frameRef}`: framer-motion measures a ref
 * constraint against the element's untransformed layout box, which equals the frame for an image
 * that fills it, so every axis came out `{ min: 0, max: 0 }` whatever the zoom.
 */
export const panBounds = (width: number, height: number, zoom: number): PanBounds => {
  const overhangX = Math.max(0, (width * (zoom - 1)) / 2);
  const overhangY = Math.max(0, (height * (zoom - 1)) / 2);
  // `+ 0` turns `-0` into `0`, so a fit photo reports plain zeros.
  return { left: -overhangX + 0, right: overhangX, top: -overhangY + 0, bottom: overhangY };
};

/** Pull an offset back inside `bounds`, e.g. after zooming out by a step left it past the edge. */
export const clampPan = (x: number, y: number, bounds: PanBounds): { x: number; y: number } => ({
  x: Math.min(bounds.right, Math.max(bounds.left, x)),
  y: Math.min(bounds.bottom, Math.max(bounds.top, y)),
});
