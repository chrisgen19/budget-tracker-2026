"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DESKTOP_QUERY = "(min-width: 640px)";
const SETTLE_MS = 180;

/**
 * How long after focus enters the toolbar a scroll is treated as caused by that
 * focus. Moving focus into a control makes the browser scroll it into view, and
 * ducking on that scroll would hide the control the reader was just handed.
 */
const FOCUS_SCROLL_MS = 150;

/**
 * Mirrors ActionFab's mobile-only scroll behaviour for the transaction toolbar:
 * duck it out of the reader's way while the page scrolls, then bring it back once
 * scrolling settles. Two cases deliberately never hide it — desktop, where the
 * toolbar is pinned and nothing is crowding the viewport, and a toolbar that owns
 * focus, because hiding an ancestor of the focused field blurs it and closes the
 * on-screen keyboard mid-query.
 */
export function useFilterToolbarScroll() {
  const toolbarRef = useRef<HTMLElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
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

    /**
     * Only text entry inside the toolbar holds it open. The guard exists so a scroll
     * cannot blur the search field and close the on-screen keyboard mid-query — a
     * button keeps focus after a tap and suffers nothing from being hidden, so
     * testing the whole subtree meant one tap on a month arrow or the type toggle
     * pinned the toolbar open for the rest of the visit.
     */
    const holdsTextEntry = () => {
      const active = document.activeElement;
      if (!active || !toolbarRef.current?.contains(active)) return false;
      return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    };

    /**
     * A scroll the browser started to bring a newly focused control into view. The
     * control would otherwise be hidden the moment it was reached — a keyboard or
     * switch user tabbing back into the toolbar on a scrolled page would watch the
     * focus indicator disappear under them.
     */
    const isFocusDrivenScroll = () =>
      Date.now() - focusEnteredAtRef.current < FOCUS_SCROLL_MS &&
      !!toolbarRef.current?.contains(document.activeElement);

    const handleScroll = () => {
      if (desktopQuery.matches || holdsTextEntry() || isFocusDrivenScroll()) {
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

    window.addEventListener("scroll", handleScroll, { passive: true });
    desktopQuery.addEventListener("change", handleBreakpointChange);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      desktopQuery.removeEventListener("change", handleBreakpointChange);
      clearTimer();
    };
  }, []);

  return { toolbarRef, isScrolling, handleToolbarFocus };
}
