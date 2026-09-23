import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useServiceWorkerUpdate } from "./use-service-worker-update";

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
let container: EventTarget & { controller: unknown; getRegistration: () => Promise<unknown> };
let reload: ReturnType<typeof vi.fn>;

const install = (controller: unknown) => {
  registration = new FakeRegistration();
  const target = new EventTarget() as typeof container;
  target.controller = controller;
  target.getRegistration = () => Promise.resolve(registration);
  container = target;
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
};

beforeEach(() => {
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
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

  // The mirror case, and why the guard is `hadController` rather than "did this tab accept": when
  // another tab accepts the update, every sibling tab's controller changes too, and those tabs are
  // the ones still running the old bundle.
  it("reloads a sibling tab when another tab accepts the update", async () => {
    renderHook(() => useServiceWorkerUpdate());
    await waitFor(() => expect(registration.update).toHaveBeenCalled());
    act(() => {
      container.dispatchEvent(new Event("controllerchange"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
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

  it("does nothing where there is no service worker at all", () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    const { result } = renderHook(() => useServiceWorkerUpdate());
    expect(result.current.updateAvailable).toBe(false);
    expect(() => result.current.applyUpdate()).not.toThrow();
  });
});
