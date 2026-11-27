"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useIsMutating } from "@tanstack/react-query";
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
 */
export function UpdateNavigationProvider({ busy, children }: UpdateNavigationProviderProps) {
  const router = useRouter();
  const { status, updateAvailable, applyUpdate, applyOnNavigation } = useServiceWorkerUpdate();

  // A write still in flight counts as busy too: a full load would abort it. Saves made from a
  // modal are already safe (the overlay covers the nav until they resolve), but a quick-log tap or
  // a preference toggle has no modal.
  const mutating = useIsMutating() > 0;

  // A ref, so the listener registered once reads the current value rather than the one at mount.
  const busyRef = useRef(busy || mutating);
  busyRef.current = busy || mutating;

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const href = getInAppHref(event, new URL(window.location.href));
      if (href && !busyRef.current && applyOnNavigation(href)) event.preventDefault();
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [applyOnNavigation]);

  const value = useMemo<UpdateNavigation>(
    () => ({
      status,
      updateAvailable,
      applyUpdate,
      navigate: (href) => {
        if (busyRef.current || !applyOnNavigation(href)) router.push(href);
      },
    }),
    [status, updateAvailable, applyUpdate, applyOnNavigation, router],
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
