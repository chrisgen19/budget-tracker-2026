"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DESKTOP_QUERY = "(min-width: 640px)";
const SETTLE_MS = 180;

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

  const revealToolbar = useCallback(() => setIsScrolling(false), []);

  useEffect(() => {
    const desktopQuery = window.matchMedia(DESKTOP_QUERY);
    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };

    const handleScroll = () => {
      if (desktopQuery.matches || toolbarRef.current?.contains(document.activeElement)) {
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

  return { toolbarRef, isScrolling, revealToolbar };
}
