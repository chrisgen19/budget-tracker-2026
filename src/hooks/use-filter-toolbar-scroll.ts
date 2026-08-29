"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DESKTOP_QUERY = "(min-width: 640px)";
const SETTLE_MS = 180;

/**
 * Fallback for where the toolbar pins itself, used only when the app chrome has no
 * header to measure. Normally the header itself is measured, so this file does not
 * have to agree with the `top-[61px]` in the toolbar's own classes.
 */
const FALLBACK_HEADER_HEIGHT_PX = 61;

/**
 * How long after focus enters the toolbar a scroll is treated as caused by that
 * focus. Moving focus into a control makes the browser scroll it into view, and
 * hiding on that scroll would hide the control the reader was just handed.
 */
const FOCUS_SCROLL_MS = 150;

/**
 * `isInPlace` is true while the toolbar's own space in the page is still on screen.
 * Up there it is an ordinary container: it scrolls away with the list, it does not
 * pin itself under the header, and it never hides. Only once that space has gone
 * entirely off the top does it become a pinned overlay that hides while the page
 * scrolls and returns when scrolling stops.
 *
 * Drawn that way, the overlay only ever exists where its own space is off screen,
 * so it can appear and disappear with nothing on screen to flash against.
 *
 * Three further cases never hide it: desktop, where nothing is crowding the
 * viewport; text entry inside the toolbar, because hiding it would blur the search
 * field and close the on-screen keyboard mid-query; and the scroll the browser
 * itself starts to bring a newly focused control into view.
 */
export function useFilterToolbarScroll() {
  const toolbarRef = useRef<HTMLElement>(null);
  /** Sits in normal flow just above the toolbar, so it marks the toolbar's own space
   *  in the page — unlike the toolbar, it is never moved by the hide transform. */
  const markerRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isInPlace, setIsInPlace] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const frameRef = useRef<number>(undefined);
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

    // Where the toolbar pins itself. It cannot be read off the toolbar, which is only
    // `sticky` while it is an overlay, so the header it tucks under is measured
    // instead — that keeps this in step with the header's real height rather than
    // with a second copy of it. A hidden header measures zero, which is also where
    // the toolbar rests at that width. Cached, since scrolling would otherwise read
    // layout twice per frame.
    let restingTop: number | null = null;
    const forgetRestingTop = () => {
      restingTop = null;
    };
    const readRestingTop = () => {
      if (restingTop !== null) return restingTop;
      const header = document.querySelector("header");
      if (!header) return FALLBACK_HEADER_HEIGHT_PX;
      const box = header.getBoundingClientRect();
      restingTop = box.height > 0 ? box.bottom : 0;
      return restingTop;
    };

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

    const evaluate = () => {
      frameRef.current = undefined;
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

    // Scroll events can outpace frames, and each evaluation reads layout while the
    // toolbar's own classes are being rewritten, so they are coalesced to one read
    // per frame rather than forcing a synchronous layout per event.
    const handleScroll = () => {
      if (frameRef.current !== undefined) return;
      frameRef.current = requestAnimationFrame(evaluate);
    };

    /**
     * Recompute the position without treating it as a scroll. The toolbar's height
     * changes when its chip row grows or collapses, and nothing scrolls when it does
     * — without this the toolbar would keep rendering in place while its space had
     * moved behind the header, and simply disappear until the next scroll.
     */
    const syncPosition = () => {
      forgetRestingTop();
      setIsInPlace(!readIsPastTop());
    };

    const handleBreakpointChange = () => {
      syncPosition();
      if (desktopQuery.matches) setIsScrolling(false);
    };

    syncPosition();

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", syncPosition);
    desktopQuery.addEventListener("change", handleBreakpointChange);

    // jsdom has no ResizeObserver, and the height-change case it covers cannot be
    // expressed there anyway, so its absence is tolerated rather than stubbed.
    const toolbar = toolbarRef.current;
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncPosition);
    if (observer && toolbar) observer.observe(toolbar);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", syncPosition);
      desktopQuery.removeEventListener("change", handleBreakpointChange);
      observer?.disconnect();
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
      clearTimer();
    };
  }, []);

  return { toolbarRef, markerRef, isScrolling, isInPlace, handleToolbarFocus };
}
