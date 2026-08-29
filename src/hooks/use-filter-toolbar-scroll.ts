"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DESKTOP_QUERY = "(min-width: 640px)";
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
 * `isOverlaying` says whether the toolbar has scrolled up under the header and is
 * now sitting on top of the list. Until it has, it is still in its own place in the
 * page, where hiding it would cover nothing and would leave a toolbar-sized gap
 * behind — so up there it does not move at all, and renders with no transition.
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
  const [isOverlaying, setIsOverlaying] = useState(false);
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

    // Where the toolbar comes to rest is a breakpoint away from changing
    // (`top-[61px] lg:top-0`), so it is read off the element rather than hardcoded —
    // and cached, since `getComputedStyle` on every scroll forces a style recalc.
    let restingTop: number | null = null;
    const forgetRestingTop = () => {
      restingTop = null;
    };
    const readRestingTop = () => {
      if (restingTop !== null) return restingTop;
      const toolbar = toolbarRef.current;
      if (!toolbar) return 0;
      const parsed = Number.parseFloat(getComputedStyle(toolbar).top);
      restingTop = Number.isFinite(parsed) ? parsed : 0;
      return restingTop;
    };

    /** True once the toolbar's own place in the page has scrolled off the top. */
    const readIsOverlaying = () => {
      const marker = markerRef.current;
      return marker ? marker.getBoundingClientRect().top < readRestingTop() : false;
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
      const overlaying = readIsOverlaying();
      setIsOverlaying(overlaying);

      if (
        !overlaying ||
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
      forgetRestingTop();
      if (desktopQuery.matches) setIsScrolling(false);
    };

    // Read once on mount, so a page restored mid-scroll starts in the right state.
    setIsOverlaying(readIsOverlaying());

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", forgetRestingTop);
    desktopQuery.addEventListener("change", handleBreakpointChange);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", forgetRestingTop);
      desktopQuery.removeEventListener("change", handleBreakpointChange);
      clearTimer();
    };
  }, []);

  return { toolbarRef, markerRef, isScrolling, isOverlaying, handleToolbarFocus };
}
