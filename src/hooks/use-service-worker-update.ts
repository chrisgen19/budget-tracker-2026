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
 * Whether work that lives only in memory (the receipt scan queue) is in flight, so a full load
 * would lose it. Read again when a hand-off finishes, not only when the tap is handled.
 */
export type IsBusy = () => boolean;

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
export function useServiceWorkerUpdate(isBusy?: IsBusy) {
  const [status, setStatus] = useState<UpdateStatus>("none");
  const statusRef = useRef<UpdateStatus>("none");
  const waitingRef = useRef<ServiceWorker | null>(null);
  const intentRef = useRef<Intent>({ kind: "none" });
  const reloadingRef = useRef(false);
  const fallbackRef = useRef<number | null>(null);

  // A ref, so a hand-off finishing later reads the current value rather than the one at mount.
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;

  const changeStatus = useCallback((next: UpdateStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  /**
   * Finish a navigation hand-off with a full load of `href` on the new build -- unless work that
   * lives only in memory turned up while it was in flight, in which case **nothing happens at all**.
   *
   * `busy` is read when the tap is handled and the load follows up to
   * `NAVIGATION_UPDATE_TIMEOUT_MS` later, so a receipt scan can start in between. A full load would
   * throw that queue away with its scan credits already spent, which is the one thing this feature
   * must not do.
   *
   * The tap is **dropped** rather than turned into a client navigation. A client `router.push` here
   * would be the one place in this hook that navigates an old bundle under a *new* controller:
   * `sw.ts` precaches the build manifest, so the activating worker evicts the old build's chunks,
   * and the container serving them has been replaced. That is the client/server skew #306 exists to
   * close, and it is exactly why a `stale` tab's taps go through `window.location.assign` instead.
   * Pushing the original `href` is also wrong by then: while busy, `UpdateNavigationProvider` stops
   * swallowing taps, so the user may have navigated somewhere else since.
   *
   * Dropping it is the honest reading of what happened. Starting a scan seconds after tapping a
   * link is a change of mind, the scan sheet is on screen, and any navigation would close it.
   *
   * `tookOver` separates the two callers, and the tab is left in a different state for each:
   * `controllerchange` means the new worker is in charge, so this bundle is the old one and there
   * is nothing left to message -- `stale`. The fallback timer fires *because* no takeover came, so
   * the worker is still installed and still ours to ask: the handle is kept and the status stays
   * `waiting`. Clearing it there cost the banner's Reload its worker, leaving a plain refresh that
   * activates nothing and a banner that only works on the remount after it.
   */
  const takeNavigation = useCallback(
    (href: string, tookOver: boolean) => {
      if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
      if (reloadingRef.current) return;

      if (isBusyRef.current?.()) {
        intentRef.current = { kind: "none" };
        if (tookOver) {
          waitingRef.current = null;
          changeStatus("stale");
        }
        return;
      }
      reloadingRef.current = true;
      window.location.assign(href);
    },
    [changeStatus],
  );

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
      if (intent.kind === "navigate") {
        takeNavigation(intent.href, true);
        return;
      }
      reloadingRef.current = true;
      window.location.reload();
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
      // A navigate hand-off leaves `waiting` in place -- the page is replaced, so there is nothing
      // to re-render -- and this restores it anyway. The worker it points at took over while the
      // page sat in the cache, and `skipWaiting` on an *active* worker is a no-op that fires no
      // `controllerchange`: Reload would do nothing and every tap would sit out the full fallback.
      // The bundle here really is old with a newer worker in charge, which is exactly `stale`.
      if (statusRef.current === "waiting" && waitingRef.current?.state !== "installed") {
        waitingRef.current = null;
        changeStatus("stale");
      }
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
  }, [changeStatus, takeNavigation]);

  /**
   * The banner's Reload. A waiting worker is told to take over and the reload follows from
   * `controllerchange`, so the page is replaced only once the new worker is in charge. A stale tab
   * has nothing to message and just refreshes.
   */
  const applyUpdate = useCallback(() => {
    // A link tap is already handing over to this worker and will load its own target. The banner is
    // still up during that wait, and overwriting the intent here would reload the page the user is
    // leaving and drop the destination on the floor.
    if (intentRef.current.kind === "navigate") return;
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
  const applyOnNavigation = useCallback(
    (href: string): boolean => {
      if (reloadingRef.current) return true;
      // A hand-off of our own is in flight and the fallback covers it, so a repeat tap is swallowed.
      if (intentRef.current.kind === "navigate") return true;
      // A `reload` intent has no fallback behind it: if `controllerchange` never came, swallowing
      // taps on the strength of it would cancel every link and menu pick in the tab until the user
      // reloaded by hand. Drop it instead and handle this tap normally -- re-arming the banner's
      // worker if it is still waiting, so the navigation takes the update under the 3s fallback,
      // and forgetting it otherwise rather than leaving a stale reload armed for the next swap.
      if (intentRef.current.kind === "reload") {
        intentRef.current = { kind: "none" };
        if (waitingRef.current?.state === "installed") changeStatus("waiting");
        else waitingRef.current = null;
      }
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
      fallbackRef.current = window.setTimeout(
        () => takeNavigation(href, false),
        NAVIGATION_UPDATE_TIMEOUT_MS,
      );
      return true;
    },
    [changeStatus, takeNavigation],
  );

  return { status, updateAvailable: status !== "none", applyUpdate, applyOnNavigation };
}
