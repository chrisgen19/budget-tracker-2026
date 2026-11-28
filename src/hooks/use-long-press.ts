"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent } from "react";

interface LongPressOptions {
  /** How long a finger must rest before it counts. */
  delayMs?: number;
  /** Movement past this cancels the press, so a scroll that starts on a row never fires it. */
  moveTolerancePx?: number;
}

/**
 * Touch-and-hold on a list row, the way Android and iOS start multi-select.
 *
 * Mouse pointers are ignored: desktop has an always-visible checkbox, and a held mouse button is
 * the start of a text selection or a drag, not a request to select the row.
 *
 * The click that ends a long-press still reaches the row, so `consumeClick()` returns true once
 * afterwards and the row's onClick should bail on it; otherwise the same gesture would select the
 * row and then immediately toggle it back off (or open the edit form).
 */
export function useLongPress(
  onLongPress: () => void,
  { delayMs = 450, moveTolerancePx = 10 }: LongPressOptions = {},
) {
  const timerRef = useRef<number | undefined>(undefined);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const callbackRef = useRef(onLongPress);

  useEffect(() => {
    callbackRef.current = onLongPress;
  }, [onLongPress]);

  const cancel = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    startRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      // Reset on every press: a long-press that ended in a pointercancel never got its click,
      // and the flag must not swallow the next, unrelated tap.
      firedRef.current = false;
      cancel();
      if (event.pointerType === "mouse") return;
      startRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined;
        startRef.current = null;
        firedRef.current = true;
        navigator.vibrate?.(10);
        callbackRef.current();
      }, delayMs);
    },
    [cancel, delayMs],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > moveTolerancePx) cancel();
    },
    [cancel, moveTolerancePx],
  );

  // Android Chrome answers a held finger with its own context menu or a text selection, which
  // would land on top of the row being selected. Only a menu raised by a touch press that is
  // still down, or that just became a long-press, is blocked: a right-click or the keyboard
  // Menu key has no press in flight and keeps its menu.
  const onContextMenu = useCallback((event: { preventDefault: () => void }) => {
    if (startRef.current || firedRef.current) event.preventDefault();
  }, []);

  const consumeClick = useCallback(() => {
    if (!firedRef.current) return false;
    firedRef.current = false;
    return true;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu,
    },
    consumeClick,
  };
}
