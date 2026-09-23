"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Whether a new build is installed and waiting, and how to take it.
 *
 * A deploy swaps the server while an open tab keeps running the bundle it loaded. `/api/*` is
 * `NetworkOnly`, so that old bundle then reads new JSON: on #304 that was a TypeError on the labels
 * page. Nothing reloaded the page, because `skipWaiting` swaps the *worker*, not the script a tab is
 * already running. `sw.ts` now lets the new worker wait, and this finds it.
 *
 * `controller` is the guard that separates an update from a first install. On the very first visit a
 * worker also reaches `installed`, and without this check every new visitor would be told an update
 * was available before they had ever loaded anything.
 *
 * Three ways a waiting worker is found, because which one fires depends on when the tab loaded
 * relative to the deploy: one already waiting when this mounts, one that finishes installing while
 * the tab is open (`updatefound`), and one that appears in another tab of the same origin, which
 * reaches this registration without an `updatefound` of its own -- so an explicit `update()` poll
 * covers the tab left open overnight.
 */
export function useServiceWorkerUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const waitingRef = useRef<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    const note = (worker: ServiceWorker | null) => {
      // `controller` is null on a first install, and only then.
      if (cancelled || !worker || !navigator.serviceWorker.controller) return;
      waitingRef.current = worker;
      setUpdateAvailable(true);
    };

    let registration: ServiceWorkerRegistration | null = null;
    const onUpdateFound = () => {
      const installing = registration?.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed") note(installing);
      });
    };

    // A reload is the whole point, so the page must not keep running once the new worker takes
    // over. `once`, since `controllerchange` also fires for reasons this hook did not ask for.
    const onControllerChange = () => window.location.reload();

    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (cancelled || !reg) return;
        registration = reg;
        note(reg.waiting);
        reg.addEventListener("updatefound", onUpdateFound);
        // Cheap, and the only thing that finds a build shipped while this tab sat untouched.
        void reg.update().catch(() => {});
      })
      .catch(() => {
        // No registration is the ordinary case in development, where Serwist is disabled. There is
        // nothing to update and nothing to report.
      });

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange, { once: true });

    return () => {
      cancelled = true;
      registration?.removeEventListener("updatefound", onUpdateFound);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  /**
   * Tell the waiting worker to take over. The reload follows from `controllerchange`, not from here,
   * so the page is replaced only once the new worker is actually in charge.
   */
  const applyUpdate = useCallback(() => {
    const waiting = waitingRef.current;
    if (!waiting) return;
    setUpdateAvailable(false);
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, []);

  return { updateAvailable, applyUpdate };
}
