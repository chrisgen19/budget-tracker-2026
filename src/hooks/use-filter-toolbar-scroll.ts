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
 * How far the page must move upward before it counts as scrolling back. Momentum
 * scrolling and rubber-band settling jitter by a pixel or two, and treating that as
 * an upward scroll would flash the toolbar back mid-flick.
 */
const UP_DELTA_PX = 2;

/**
 * Mirrors ActionFab's mobile-only scroll behaviour for the transaction toolbar:
 * duck it out of the reader's way while the page scrolls, then bring it back once
 * scrolling settles.
 *
 * Four cases deliberately never hide it:
 * - desktop, where the toolbar is pinned and nothing is crowding the viewport;
 * - a toolbar that owns focus, because hiding an ancestor of the focused field
 *   blurs it and closes the on-screen keyboard mid-query;
 * - a toolbar that is not stuck yet. Unlike ActionFab, which is `fixed` and so
 *   leaves nothing behind, this one occupies real layout: ducking it before its
 *   space has scrolled off the top tears a toolbar-sized blank band into the page.
 *   It earns the right to duck once it is overlaying the list rather than sitting
 *   in it;
 * - scrolling back up, which is the reader reaching for the filters. Waiting out
 *   the settle delay to hand them back is the difference between a toolbar that
 *   feels responsive and one that feels stuck.
 */
export function useFilterToolbarScroll() {
  const toolbarRef = useRef<HTMLElement>(null);
  /** Sits in normal flow just above the toolbar, so it marks the toolbar's natural
   *  position and — unlike the toolbar — is never moved by the hide transform. */
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastScrollYRef = useRef(0);

  const revealToolbar = useCallback(() => setIsScrolling(false), []);

  useEffect(() => {
    const desktopQuery = window.matchMedia(DESKTOP_QUERY);
    lastScrollYRef.current = window.scrollY;
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
      const scrollY = window.scrollY;
      const scrollingUp = scrollY < lastScrollYRef.current - UP_DELTA_PX;
      lastScrollYRef.current = scrollY;

      if (
        desktopQuery.matches ||
        !isStuck() ||
        scrollingUp ||
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
