"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useServiceWorkerUpdate, type UpdateStatus } from "@/hooks/use-service-worker-update";
import { getInAppHref } from "@/lib/in-app-link";

interface UpdateNavigation {
  status: UpdateStatus;
  updateAvailable: boolean;
  applyUpdate: () => void;
  /** `router.push`, except that a waiting update is taken on the way as a full load of `href`. */
  navigate: (href: string) => void;
}

const UpdateNavigationContext = createContext<UpdateNavigation | null>(null);

interface UpdateNavigationProviderProps {
  /** True while work lives only in memory (the receipt scan queue), so a full load would lose it. */
  busy: boolean;
  children: ReactNode;
}

/**
 * Takes a waiting app update on the next safe in-app navigation, so nobody has to tap Reload.
 *
 * A capture-phase click listener sees a link tap before `next/link` does. When an update is ready
 * and nothing is busy, it cancels the tap, and `next/link` skips its client navigation for a click
 * that is already default-prevented; the hook then full-loads the target on the new build. Profile
 * menu items are `router.push` calls, not links, so they go through `navigate` instead.
 *
 * Mounted once in `AppShell`, which also owns the scan queue `busy` is read from. The banner reads
 * the same context, so the service worker hook runs once per tab.
 *
 * `busy` gates three things: the tap, the full load that follows it up to 3s later (through the
 * callback passed to the hook), and the banner, which would otherwise offer a reload that destroys
 * the very queue the first two protect.
 */
export function UpdateNavigationProvider({ busy, children }: UpdateNavigationProviderProps) {
  const router = useRouter();

  // A ref, so the listener registered once reads the current value rather than the one at mount.
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // `busy` is read again when the hand-off finishes, not only when the tap is handled: a scan can
  // start inside the up-to-3s wait, and the full load would then discard its queue. Passed fresh
  // each render on purpose -- the hook keeps it in a ref, so there is nothing to memoize.
  const { status, updateAvailable, applyUpdate, applyOnNavigation } = useServiceWorkerUpdate(
    () => busyRef.current,
  );

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const href = getInAppHref(event, new URL(window.location.href));
      if (href && !busyRef.current && applyOnNavigation(href)) event.preventDefault();
    };
    // Capture, and it has to be: React attaches its own listeners to the root container, so a
    // `document` listener in the bubble phase runs *after* `next/link`'s `onClick` has already
    // called `router.push`, and there is nothing left to take over. Re-checking in a microtask is
    // too late for the same reason -- `preventDefault` has to be decided synchronously.
    //
    // The price is that `getInAppHref`'s `event.defaultPrevented` check cannot see a component's
    // own `preventDefault`, since that handler has not run yet. No link in the app does that
    // today, so this is a trap for later rather than a live bug: an `<a>` whose `onClick` prevents
    // the default to open a modal would be taken over here and full-load to its `href` instead.
    // Such a link should be a `<button>`, or opt out another way -- moving this listener to the
    // bubble phase breaks the mechanism outright.
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [applyOnNavigation]);

  const value = useMemo<UpdateNavigation>(
    () => ({
      status,
      // The banner is hidden while the scan queue is in memory, and that is the whole guard on it:
      // `applyUpdate` for a `stale` tab is an unguarded `window.location.reload()`, and the banner
      // is its only caller. Without this the amber bar appears over the review sheet the moment a
      // hand-off marks the tab stale, and one tap destroys the queue with its credits spent -- the
      // anti-goal this feature is built around.
      updateAvailable: updateAvailable && !busy,
      applyUpdate,
      navigate: (href) => {
        if (busyRef.current || !applyOnNavigation(href)) router.push(href);
      },
    }),
    [status, updateAvailable, busy, applyUpdate, applyOnNavigation, router],
  );

  return <UpdateNavigationContext.Provider value={value}>{children}</UpdateNavigationContext.Provider>;
}

/**
 * The update state and an update-aware `navigate`. Outside the provider (the Mini App, isolated
 * tests) there is no update to take, so `navigate` is plain `router.push`.
 */
export function useUpdateNavigation(): UpdateNavigation {
  const context = useContext(UpdateNavigationContext);
  const router = useRouter();
  return (
    context ?? {
      status: "none",
      updateAvailable: false,
      applyUpdate: () => {},
      navigate: (href) => router.push(href),
    }
  );
}
