"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DESKTOP_QUERY = "(min-width: 640px)";
/** Where the toolbar stops tucking under the mobile header. Mirrors its `lg:` variant. */
const HEADER_GONE_QUERY = "(min-width: 1024px)";
/** The mobile header's height, and so the toolbar's `top-[61px]` when it does pin. */
const HEADER_HEIGHT_PX = 61;
const SETTLE_MS = 180;

/**
 * How long after focus enters the toolbar a scroll is treated as caused by that
 * focus. Moving focus into a control makes the browser scroll it into view, and
 * hiding on that scroll would hide the control the reader was just handed.
 */
const FOCUS_SCROLL_MS = 150;

/**
 * Mirrors ActionFab's mobile-only scroll behaviour for the transaction toolbar:
 * hide it while the page scrolls, show it again once scrolling settles.
 *
 * `isInPlace` is true while the toolbar's own space in the page is still on screen.
 * Up there it is an ordinary container: it scrolls away with the list, it does not
 * pin itself under the header, and it never hides. Only once that space has gone
 * entirely off the top does it become a pinned overlay that hides while the page
 * scrolls and returns when scrolling stops.
 *
 * Drawn that way, the overlay only ever exists where its own space is off screen,
 * so it can appear and disappear with nothing on screen to flash against — which
 * is why the in-place state carries no transition.
 *
 * Three further cases never hide it: desktop, where nothing is crowding the
 * viewport; text entry inside the toolbar, because hiding it would blur the search
 * field and close the on-screen keyboard mid-query; and the scroll the browser
 * itself starts to bring a newly focused control into view.
 */
export function useFilterToolbarScroll() {
  const toolbarRef = useRef<HTMLElement>(null);
  /** Sits in normal flow just above the toolbar, so it marks the toolbar's own place
   *  in the page — unlike the toolbar, it is never moved by the hide transform. */
  const markerRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isInPlace, setIsInPlace] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusEnteredAtRef = useRef(0);

  /** Bound to the toolbar's `onFocusCapture`, so it fires as focus enters it. */
  const handleToolbarFocus = useCallback(() => {
    focusEnteredAtRef.current = Date.now();
    setIsScrolling(false);
  }, []);

  useEffect(() => {
    const desktopQuery = window.matchMedia(DESKTOP_QUERY);
    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };

    // Where the toolbar pins itself when it is an overlay. It cannot be read off the
    // element, because the element is only `sticky` while it is one — in its own
    // place it is an ordinary container whose computed `top` is `auto`.
    const headerGoneQuery = window.matchMedia(HEADER_GONE_QUERY);
    const readRestingTop = () => (headerGoneQuery.matches ? 0 : HEADER_HEIGHT_PX);

    /**
     * True once the toolbar's own space in the page sits entirely above where the
     * toolbar comes to rest — that is, once that space is off screen. Measured from
     * the marker, which the hide transform never moves, plus `offsetHeight`, which
     * is a layout box and so is not moved by the transform either.
     */
    const readIsPastTop = () => {
      const marker = markerRef.current;
      const toolbar = toolbarRef.current;
      if (!marker || !toolbar) return false;
      return marker.getBoundingClientRect().top + toolbar.offsetHeight <= readRestingTop();
    };

    /** Only text entry holds the toolbar open; a button suffers nothing from hiding. */
    const holdsTextEntry = () => {
      const active = document.activeElement;
      if (!active || !toolbarRef.current?.contains(active)) return false;
      return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    };

    const isFocusDrivenScroll = () =>
      Date.now() - focusEnteredAtRef.current < FOCUS_SCROLL_MS &&
      !!toolbarRef.current?.contains(document.activeElement);

    const handleScroll = () => {
      const pastTop = readIsPastTop();
      setIsInPlace(!pastTop);

      if (
        !pastTop ||
        desktopQuery.matches ||
        holdsTextEntry() ||
        isFocusDrivenScroll()
      ) {
        setIsScrolling(false);
        clearTimer();
        return;
      }

      setIsScrolling(true);
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        setIsScrolling(false);
      }, SETTLE_MS);
    };

    const handleBreakpointChange = () => {
      if (desktopQuery.matches) setIsScrolling(false);
    };

    // Read once on mount, so a page restored mid-scroll starts in the right state.
    setIsInPlace(!readIsPastTop());

    window.addEventListener("scroll", handleScroll, { passive: true });
    desktopQuery.addEventListener("change", handleBreakpointChange);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      desktopQuery.removeEventListener("change", handleBreakpointChange);
      clearTimer();
    };
  }, []);

  return { toolbarRef, markerRef, isScrolling, isInPlace, handleToolbarFocus };
}
