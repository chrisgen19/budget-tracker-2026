"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How often an open tab asks whether a new build exists. */
const UPDATE_POLL_MS = 60 * 60 * 1000;

/**
 * How long a navigation waits for the new worker to take over before loading the target anyway, so
 * a tap never goes dead if `controllerchange` is slow or never comes.
 */
export const NAVIGATION_UPDATE_TIMEOUT_MS = 3000;

/**
 * - `none`: nothing to take.
 * - `waiting`: a new worker is installed and waiting for this tab to accept it.
 * - `stale`: another tab accepted it, so this tab's worker is new but its bundle is old. There is no
 *   waiting worker left to message; a full load is all it needs.
 */
export type UpdateStatus = "none" | "waiting" | "stale";

/** What this tab asked for, which decides what its next `controllerchange` does. */
type Intent = { kind: "none" } | { kind: "reload" } | { kind: "navigate"; href: string };

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
 *
 * The update is taken either from the banner (`applyUpdate`) or on the next safe in-app navigation
 * (`applyOnNavigation`, called by `UpdateNavigationProvider`), which full-loads the target instead of
 * reloading the page the user is leaving.
 */
export function useServiceWorkerUpdate() {
  const [status, setStatus] = useState<UpdateStatus>("none");
  const statusRef = useRef<UpdateStatus>("none");
  const waitingRef = useRef<ServiceWorker | null>(null);
  const intentRef = useRef<Intent>({ kind: "none" });
  const reloadingRef = useRef(false);
  const fallbackRef = useRef<number | null>(null);

  const changeStatus = useCallback((next: UpdateStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    const note = (worker: ServiceWorker | null) => {
      // `controller` is null on a first install, and only then.
      if (cancelled || !worker || !navigator.serviceWorker.controller) return;
      waitingRef.current = worker;
      // Wins over `stale` too: a newer build is waiting, and Reload should hand over to it.
      changeStatus("waiting");
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
    // A real swap this tab did not ask for comes from a sibling tab accepting the update. That tab
    // is left running the old bundle, but it may be mid-scan or mid-form, so it is marked stale and
    // offered the banner instead of being reloaded out from under the user.
    let controlled = navigator.serviceWorker.controller !== null;
    const onControllerChange = () => {
      if (!controlled) {
        controlled = true;
        return;
      }
      if (reloadingRef.current) return;
      const intent = intentRef.current;
      if (intent.kind === "none") {
        waitingRef.current = null;
        changeStatus("stale");
        return;
      }
      reloadingRef.current = true;
      if (intent.kind === "navigate") window.location.assign(intent.href);
      else window.location.reload();
    };

    // `ready`, not `getRegistration()`. `@serwist/window` defers `register()` until the window's
    // `load` event, which this effect usually beats, so on a first visit `getRegistration()` came
    // back empty and was never asked again: `check` then bailed on a null registration for the
    // life of the tab, and a deploy while it stayed open was never offered. `ready` waits for the
    // registration instead, and resolves at once when one is already active. In development, where
    // Serwist is disabled, it never resolves, which is the same as having nothing to update.
    void navigator.serviceWorker.ready
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        note(reg.waiting);
        reg.addEventListener("updatefound", onUpdateFound);
        check();
      })
      .catch(() => {});

    // A full-load hand-off leaves this page in the back/forward cache. Restored by Back, it is the
    // old bundle again and nothing is in flight, so the hand-off state is cleared; otherwise every
    // later tap would be swallowed as "already pending" and do nothing.
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
      intentRef.current = { kind: "none" };
      reloadingRef.current = false;
    };

    const poll = window.setInterval(check, UPDATE_POLL_MS);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      registration?.removeEventListener("updatefound", onUpdateFound);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("pageshow", onPageShow);
      if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
    };
  }, [changeStatus]);

  /**
   * The banner's Reload. A waiting worker is told to take over and the reload follows from
   * `controllerchange`, so the page is replaced only once the new worker is in charge. A stale tab
   * has nothing to message and just refreshes.
   */
  const applyUpdate = useCallback(() => {
    if (statusRef.current === "stale") {
      window.location.reload();
      return;
    }
    const waiting = waitingRef.current;
    if (!waiting) return;
    intentRef.current = { kind: "reload" };
    changeStatus("none");
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [changeStatus]);

  /**
   * Take the update on the way to `href`, as a full load of the target. Returns `true` when this hook
   * has taken over the navigation, so the caller must not also navigate; `false` lets the normal
   * client navigation happen (no update, or offline, where a full load could land on the offline
   * fallback). A second tap while one is pending is swallowed rather than navigated twice.
   */
  const applyOnNavigation = useCallback((href: string): boolean => {
    if (intentRef.current.kind !== "none" || reloadingRef.current) return true;
    if (statusRef.current === "none" || !navigator.onLine) return false;

    if (statusRef.current === "stale") {
      reloadingRef.current = true;
      window.location.assign(href);
      return true;
    }

    const waiting = waitingRef.current;
    if (!waiting) return false;
    intentRef.current = { kind: "navigate", href };
    waiting.postMessage({ type: "SKIP_WAITING" });
    fallbackRef.current = window.setTimeout(() => {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.assign(href);
    }, NAVIGATION_UPDATE_TIMEOUT_MS);
    return true;
  }, []);

  return { status, updateAvailable: status !== "none", applyUpdate, applyOnNavigation };
}
