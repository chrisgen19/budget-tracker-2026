import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NAVIGATION_UPDATE_TIMEOUT_MS, useServiceWorkerUpdate } from "./use-service-worker-update";

/** A ServiceWorker is an EventTarget with a state and postMessage; that is all this hook touches. */
class FakeWorker extends EventTarget {
  state: ServiceWorker["state"] = "installing";
  postMessage = vi.fn();
  become(state: ServiceWorker["state"]) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn().mockResolvedValue(undefined);
}

let registration: FakeRegistration;
let container: EventTarget & { controller: unknown; ready: Promise<unknown> };
let reload: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

const install = (controller: unknown, ready?: Promise<unknown>) => {
  registration = new FakeRegistration();
  const target = new EventTarget() as typeof container;
  target.controller = controller;
  target.ready = ready ?? Promise.resolve(registration);
  container = target;
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
};

/** A tab with a worker already waiting when it mounts. */
const renderWaiting = async () => {
  const waiting = new FakeWorker();
  // `registration.waiting` is an installed worker by definition; the hook reads the state back to
  // tell one still waiting from one that has since taken over.
  waiting.state = "installed";
  registration.waiting = waiting;
  const hook = renderHook(() => useServiceWorkerUpdate());
  await waitFor(() => expect(hook.result.current.status).toBe("waiting"));
  return { ...hook, waiting };
};

/** A tab whose controller was swapped by another tab accepting the update. */
const renderStale = async () => {
  const hook = renderHook(() => useServiceWorkerUpdate());
  await waitFor(() => expect(registration.update).toHaveBeenCalled());
  act(() => {
    container.dispatchEvent(new Event("controllerchange"));
  });
  await waitFor(() => expect(hook.result.current.status).toBe("stale"));
  return hook;
};

beforeEach(() => {
  reload = vi.fn();
  assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload, assign },
  });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  install({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useServiceWorkerUpdate", () => {
  it("reports a worker that is already waiting when the tab mounts", async () => {
    registration.waiting = new FakeWorker();
    const { result } = renderHook(() => useServiceWorkerUpdate());
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));
  });

  // The guard that separates an update from a first install: a worker reaches `installed` on a
  // first visit too, and without this every new visitor is told to reload before they have loaded
  // anything. `controller` is null exactly then.
  it("stays quiet on a first install, when there is no controller", async () => {
    install(null);
    registration.waiting = new FakeWorker();
    const { result } = renderHook(() => useServiceWorkerUpdate());
    await waitFor(() => expect(registration.update).toHaveBeenCalled());
    expect(result.current.updateAvailable).toBe(false);
  });

  it("reports a worker that finishes installing while the tab is open", async () => {
    const { result } = renderHook(() => useServiceWorkerUpdate());
    await waitFor(() => expect(registration.update).toHaveBeenCalled());
    expect(result.current.updateAvailable).toBe(false);

    const installing = new FakeWorker();
    registration.installing = installing;
    act(() => {
      registration.dispatchEvent(new Event("updatefound"));
      installing.become("installed");
    });
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));
  });

  it("checks once at mount, before any polling", async () => {
    renderHook(() => useServiceWorkerUpdate());
    await waitFor(() => expect(registration.update).toHaveBeenCalledTimes(1));
  });

  it("asks the waiting worker to take over, and reloads only once it has", async () => {
    const waiting = new FakeWorker();
    registration.waiting = waiting;
    const { result } = renderHook(() => useServiceWorkerUpdate());
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));

    act(() => result.current.applyUpdate());
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    // Not yet: the page is replaced when the new worker is in charge, not when it is asked.
    expect(reload).not.toHaveBeenCalled();

    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // `clientsClaim` fires `controllerchange` when a worker claims a page that had no controller,
  // which is every first visit: first load, cleared site data, incognito, the installed PWA's cold
  // launch. Reloading there is a reload nobody asked for, on a page that is already current.
  it("does not reload when a first install claims the page", async () => {
    install(null);
    const { result } = renderHook(() => useServiceWorkerUpdate());
    await waitFor(() => expect(registration.update).toHaveBeenCalled());
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(result.current.updateAvailable).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  // The mirror case: when another tab accepts the update, every sibling tab's controller changes
  // too. Those tabs still run the old bundle, but one may be mid-scan or mid-form, so it is marked
  // stale and offered the banner rather than reloaded out from under the user.
  it("marks a sibling tab stale instead of reloading it", async () => {
    const { result } = renderHook(() => useServiceWorkerUpdate());
    await waitFor(() => expect(registration.update).toHaveBeenCalled());
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(result.current.status).toBe("stale");
    expect(result.current.updateAvailable).toBe(true);
  });

  it("refreshes a stale tab when its banner Reload is tapped", async () => {
    const { result } = await renderStale();
    act(() => result.current.applyUpdate());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("takes a waiting update on navigation and loads the target once the worker is in charge", async () => {
    const { result, waiting } = await renderWaiting();
    let taken = false;
    act(() => {
      taken = result.current.applyOnNavigation("/bills");
    });
    expect(taken).toBe(true);
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(assign).not.toHaveBeenCalled();

    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/bills");
    expect(reload).not.toHaveBeenCalled();
  });

  it("falls back to loading the target if the worker never takes over", async () => {
    const { result } = await renderWaiting();
    vi.useFakeTimers();
    try {
      act(() => {
        result.current.applyOnNavigation("/goals");
      });
      act(() => {
        vi.advanceTimersByTime(NAVIGATION_UPDATE_TIMEOUT_MS);
      });
      expect(assign).toHaveBeenCalledWith("/goals");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not load twice when the worker takes over after the fallback", async () => {
    const { result } = await renderWaiting();
    vi.useFakeTimers();
    try {
      act(() => {
        result.current.applyOnNavigation("/goals");
      });
      act(() => {
        vi.advanceTimersByTime(NAVIGATION_UPDATE_TIMEOUT_MS);
      });
      act(() => {
        container.dispatchEvent(new Event("controllerchange"));
      });
      expect(assign).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a second tap while an update is pending", async () => {
    const { result, waiting } = await renderWaiting();
    const taps: boolean[] = [];
    act(() => {
      taps.push(result.current.applyOnNavigation("/bills"));
      taps.push(result.current.applyOnNavigation("/goals"));
    });
    expect(taps).toEqual([true, true]);
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
  });

  it("loads the target straight away from a stale tab", async () => {
    const { result } = await renderStale();
    let taken = false;
    act(() => {
      taken = result.current.applyOnNavigation("/labels");
    });
    expect(taken).toBe(true);
    expect(assign).toHaveBeenCalledWith("/labels");
  });

  it("lets the navigation through when there is no update or the tab is offline", async () => {
    const idle = renderHook(() => useServiceWorkerUpdate());
    await waitFor(() => expect(registration.update).toHaveBeenCalled());
    expect(idle.result.current.applyOnNavigation("/bills")).toBe(false);
    idle.unmount();

    const { result, waiting } = await renderWaiting();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    expect(result.current.applyOnNavigation("/bills")).toBe(false);
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });

  // A full load leaves this page in the back/forward cache. Restored by Back, it must not still
  // think a hand-off is in flight, or every later tap is swallowed and does nothing.
  it("takes navigations again after the page is restored from the back/forward cache", async () => {
    const { result } = await renderStale();
    act(() => {
      result.current.applyOnNavigation("/labels");
    });
    expect(assign).toHaveBeenCalledTimes(1);

    act(() => {
      const restored = new Event("pageshow");
      Object.defineProperty(restored, "persisted", { value: true });
      window.dispatchEvent(restored);
    });
    act(() => {
      result.current.applyOnNavigation("/goals");
    });
    expect(assign).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenLastCalledWith("/goals");
  });

  // The banner posts `SKIP_WAITING` and waits for `controllerchange` with no fallback of its own.
  // When that never arrives -- a redundant worker, or one that is already the controller -- the
  // pending intent must not cancel every later link tap, which is what the provider does with a
  // swallowed click. Before this guard the tab's navigation was dead until a manual reload.
  it("keeps navigation working after a banner Reload that never takes over", async () => {
    const { result, waiting } = await renderWaiting();
    act(() => result.current.applyUpdate());
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);

    let taken: boolean | undefined;
    act(() => {
      taken = result.current.applyOnNavigation("/goals");
    });
    // The worker is still waiting, so the tap takes the update properly rather than going nowhere.
    expect(taken).toBe(true);
    expect(waiting.postMessage).toHaveBeenCalledTimes(2);
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(assign).toHaveBeenCalledWith("/goals");
    expect(reload).not.toHaveBeenCalled();
  });

  it("lets the navigation through when a failed Reload left no worker to take", async () => {
    const { result, waiting } = await renderWaiting();
    act(() => result.current.applyUpdate());
    waiting.state = "redundant";
    expect(result.current.applyOnNavigation("/goals")).toBe(false);
    // Nothing is armed either, so a later swap from another tab is not read as this tab's reload.
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.status).toBe("stale"));
  });

  // The banner is still up during a navigation hand-off, so Reload is reachable for those 3s.
  it("ignores the banner Reload while a navigation hand-off is in flight", async () => {
    const { result, waiting } = await renderWaiting();
    act(() => {
      result.current.applyOnNavigation("/goals");
    });
    act(() => result.current.applyUpdate());
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);

    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(assign).toHaveBeenCalledWith("/goals");
    expect(reload).not.toHaveBeenCalled();
  });

  // The hand-off leaves `waiting` behind because the page is replaced. Restored from the cache it
  // is the old bundle under a worker that is already the controller: Reload would post
  // `SKIP_WAITING` to it and never hear back, and every tap would sit out the full fallback.
  it("marks the page stale when Back restores it after a waiting hand-off", async () => {
    const { result, waiting } = await renderWaiting();
    act(() => {
      result.current.applyOnNavigation("/goals");
    });
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    waiting.state = "activated";

    act(() => {
      const restored = new Event("pageshow");
      Object.defineProperty(restored, "persisted", { value: true });
      window.dispatchEvent(restored);
    });
    await waitFor(() => expect(result.current.status).toBe("stale"));

    reload.mockClear();
    act(() => result.current.applyUpdate());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(waiting.postMessage).toHaveBeenCalledTimes(1);
  });

  // `busy` is read when the tap is handled, and the load follows up to 3s later. A scan started in
  // between lives only in memory with its credits already spent, so the full load is abandoned --
  // and not swapped for a client navigation, which on this path would run the old bundle under the
  // worker that has just evicted its chunks.
  it("drops the navigation and marks the tab stale when a scan starts during the hand-off", async () => {
    let busy = false;
    const waiting = new FakeWorker();
    registration.waiting = waiting;
    const { result } = renderHook(() => useServiceWorkerUpdate(() => busy));
    await waitFor(() => expect(result.current.status).toBe("waiting"));

    act(() => {
      result.current.applyOnNavigation("/bills");
    });
    busy = true;
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });

    expect(assign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    // The worker is in charge now, so there is nothing left to ask and the bundle really is old.
    expect(result.current.status).toBe("stale");
  });

  // The fallback fires *because* no takeover came, so the worker is still installed. Clearing it
  // here left the banner's Reload with nothing to message: a refresh that activates nothing.
  it("keeps the waiting worker when the fallback fires while busy", async () => {
    let busy = false;
    const waiting = new FakeWorker();
    registration.waiting = waiting;
    const { result } = renderHook(() => useServiceWorkerUpdate(() => busy));
    await waitFor(() => expect(result.current.status).toBe("waiting"));

    vi.useFakeTimers();
    try {
      act(() => {
        result.current.applyOnNavigation("/goals");
      });
      busy = true;
      act(() => {
        vi.advanceTimersByTime(NAVIGATION_UPDATE_TIMEOUT_MS);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(assign).not.toHaveBeenCalled();
    expect(result.current.status).toBe("waiting");

    // The handle survived, so the banner still hands over rather than refreshing for nothing.
    busy = false;
    act(() => result.current.applyUpdate());
    expect(waiting.postMessage).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  // A dropped hand-off must leave nothing armed, or the next tap is swallowed as already pending.
  it("takes a later navigation normally after one was dropped while busy", async () => {
    let busy = false;
    registration.waiting = new FakeWorker();
    const { result } = renderHook(() => useServiceWorkerUpdate(() => busy));
    await waitFor(() => expect(result.current.status).toBe("waiting"));

    act(() => {
      result.current.applyOnNavigation("/bills");
    });
    busy = true;
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });

    busy = false;
    let taken = false;
    act(() => {
      taken = result.current.applyOnNavigation("/labels");
    });
    expect(taken).toBe(true);
    expect(assign).toHaveBeenCalledWith("/labels");
  });

  // The banner path has the same hole and a wider window: `applyUpdate` arms a `reload` intent and
  // no fallback, so the wait for the swap is unbounded and a scan can begin anywhere inside it.
  it("does not reload on the banner path when a scan starts before the swap lands", async () => {
    let busy = false;
    const waiting = new FakeWorker();
    registration.waiting = waiting;
    const { result } = renderHook(() => useServiceWorkerUpdate(() => busy));
    await waitFor(() => expect(result.current.status).toBe("waiting"));

    act(() => result.current.applyUpdate());
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });

    busy = true;
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });

    expect(reload).not.toHaveBeenCalled();
    expect(result.current.status).toBe("stale");
  });

  // `AnimatePresence` keeps the banner mounted and clickable through its 0.4s exit, so hiding it
  // when `busy` flips is not the guard. The action has to refuse on its own.
  it("ignores the banner's Reload while a scan is busy", async () => {
    const waiting = new FakeWorker();
    registration.waiting = waiting;
    const { result } = renderHook(() => useServiceWorkerUpdate(() => true));
    await waitFor(() => expect(result.current.status).toBe("waiting"));

    act(() => result.current.applyUpdate());
    expect(reload).not.toHaveBeenCalled();
    expect(waiting.postMessage).not.toHaveBeenCalled();
  });

  // The ordinary case must not change: nothing in memory, so the hand-off is still a full load.
  it("still full-loads the target when nothing is busy", async () => {
    registration.waiting = new FakeWorker();
    const { result } = renderHook(() => useServiceWorkerUpdate(() => false));
    await waitFor(() => expect(result.current.status).toBe("waiting"));

    act(() => {
      result.current.applyOnNavigation("/labels");
    });
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(assign).toHaveBeenCalledWith("/labels");
  });

  it("prefers a newer waiting worker over a stale state", async () => {
    const { result } = await renderStale();
    const installing = new FakeWorker();
    registration.installing = installing;
    act(() => {
      registration.dispatchEvent(new Event("updatefound"));
      installing.become("installed");
    });
    await waitFor(() => expect(result.current.status).toBe("waiting"));
    act(() => result.current.applyUpdate());
    expect(installing.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).not.toHaveBeenCalled();
  });

  // The trap the first-install guard opened: the claim consumed the only listener, so the tab that
  // most needs the reload -- one that started uncontrolled and stayed open across a deploy -- got a
  // banner whose button did nothing. An installed PWA left open after its first launch is exactly
  // this tab.
  it("still reloads a tab that was claimed first and updated later", async () => {
    install(null);
    const { result } = renderHook(() => useServiceWorkerUpdate());
    await waitFor(() => expect(registration.update).toHaveBeenCalled());

    // The first claim: not an update, must not reload.
    act(() => {
      container.controller = {};
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).not.toHaveBeenCalled();

    // A deploy lands while the tab is still open.
    const installing = new FakeWorker();
    registration.installing = installing;
    act(() => {
      registration.dispatchEvent(new Event("updatefound"));
      installing.become("installed");
    });
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));

    act(() => result.current.applyUpdate());
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps polling, and checks again when the tab is brought back", async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useServiceWorkerUpdate());
      await act(async () => {});
      expect(registration.update).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(60 * 60 * 1000);
      });
      expect(registration.update).toHaveBeenCalledTimes(2);

      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(registration.update).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling once the hook unmounts", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() => useServiceWorkerUpdate());
      await act(async () => {});
      unmount();
      act(() => {
        vi.advanceTimersByTime(3 * 60 * 60 * 1000);
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(registration.update).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // `@serwist/window` registers only after the window's `load` event, which the hook's effect
  // usually beats. A first-visit tab then mounted with no registration and never looked again, so
  // a deploy while it stayed open was never offered.
  it("picks up a registration that only appears after mount", async () => {
    let register: (reg: unknown) => void = () => {};
    install(null, new Promise((resolve) => (register = resolve)));
    const { result } = renderHook(() => useServiceWorkerUpdate());
    await act(async () => {});
    expect(registration.update).not.toHaveBeenCalled();

    await act(async () => register(registration));
    expect(registration.update).toHaveBeenCalledTimes(1);

    // The first claim, then a deploy while the tab stays open.
    act(() => {
      container.controller = {};
      container.dispatchEvent(new Event("controllerchange"));
    });
    const installing = new FakeWorker();
    registration.installing = installing;
    act(() => {
      registration.dispatchEvent(new Event("updatefound"));
      installing.become("installed");
    });
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));
  });

  it("does nothing where there is no service worker at all", () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    const { result } = renderHook(() => useServiceWorkerUpdate());
    expect(result.current.updateAvailable).toBe(false);
    expect(() => result.current.applyUpdate()).not.toThrow();
  });
});
