"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How often an open tab asks whether a new build exists. */
const UPDATE_POLL_MS = 60 * 60 * 1000;

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

    /**
     * Ask the browser whether a new worker exists.
     *
     * One call at mount is not a poll, which is what this used to be: a tab that mounted *before*
     * the deploy found nothing and never looked again. The browser does not reliably cover that --
     * a client-side route change is not a navigation, so it triggers no update check, and the
     * functional-event check only runs after about a day. Hence an interval, and a check when the
     * tab is brought back, which is when someone is actually there to see the prompt.
     */
    const check = () => {
      if (cancelled || !registration || !navigator.onLine) return;
      void registration.update().catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    const onUpdateFound = () => {
      const installing = registration?.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed") note(installing);
      });
    };

    // `clientsClaim` makes `controllerchange` fire when a worker claims a page that had no
    // controller, which is every first visit: first load, cleared site data, incognito, the
    // installed PWA's cold launch. Reloading there is a reload nobody asked for, on a page that is
    // already current. Only the *first* such change is that claim; every later one is a real swap.
    //
    // Tracked as it changes rather than read once at mount, and the listener is not `once`. Both
    // together were a trap: a tab that started uncontrolled spent its only listener on the claim,
    // so when a deploy later landed the banner appeared and its button did nothing. An installed
    // PWA left open after its first launch is exactly that tab.
    //
    // Gated on this rather than on the tab having called `applyUpdate`, deliberately: when another
    // tab accepts, every sibling tab's controller changes too, and those siblings are the ones left
    // running the old bundle.
    let controlled = navigator.serviceWorker.controller !== null;
    let reloading = false;
    const onControllerChange = () => {
      if (!controlled) {
        controlled = true;
        return;
      }
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (cancelled || !reg) return;
        registration = reg;
        note(reg.waiting);
        reg.addEventListener("updatefound", onUpdateFound);
        check();
      })
      .catch(() => {
        // No registration is the ordinary case in development, where Serwist is disabled. There is
        // nothing to update and nothing to report.
      });

    const poll = window.setInterval(check, UPDATE_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
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
