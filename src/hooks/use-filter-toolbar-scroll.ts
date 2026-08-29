"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DESKTOP_QUERY = "(min-width: 640px)";
const SETTLE_MS = 180;

/**
 * Where the toolbar docks once it is stuck, matching its own `top-[61px]` and the
 * height of the mobile header it tucks under. Only the mobile value matters, since
 * ducking is disabled from `sm` up.
 */
const STICKY_TOP_PX = 61;

/**
 * Mirrors ActionFab's mobile-only scroll behaviour for the transaction toolbar:
 * duck it out of the reader's way while the page scrolls, then bring it back once
 * scrolling settles.
 *
 * Three cases deliberately never hide it:
 * - desktop, where the toolbar is pinned and nothing is crowding the viewport;
 * - a toolbar that owns focus, because hiding an ancestor of the focused field
 *   blurs it and closes the on-screen keyboard mid-query;
 * - a toolbar that is not stuck yet — at the top of the page it occupies its own
 *   place in the flow, so hiding it covers nothing and only flickers. It earns the
 *   right to duck once the page has scrolled past it and it is overlaying the list.
 */
export function useFilterToolbarScroll() {
  const toolbarRef = useRef<HTMLElement>(null);
  /** Sits in normal flow just above the toolbar, so it marks the toolbar's natural
   *  position and — unlike the toolbar — is never moved by the hide transform. */
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const revealToolbar = useCallback(() => setIsScrolling(false), []);

  useEffect(() => {
    const desktopQuery = window.matchMedia(DESKTOP_QUERY);
    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };

    /** The toolbar is stuck once its natural position has scrolled under the header. */
    const isStuck = () => {
      const sentinel = sentinelRef.current;
      return sentinel ? sentinel.getBoundingClientRect().top < STICKY_TOP_PX : false;
    };

    const handleScroll = () => {
      if (
        desktopQuery.matches ||
        !isStuck() ||
        toolbarRef.current?.contains(document.activeElement)
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

    window.addEventListener("scroll", handleScroll, { passive: true });
    desktopQuery.addEventListener("change", handleBreakpointChange);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      desktopQuery.removeEventListener("change", handleBreakpointChange);
      clearTimer();
    };
  }, []);

  return { toolbarRef, sentinelRef, isScrolling, revealToolbar };
}
