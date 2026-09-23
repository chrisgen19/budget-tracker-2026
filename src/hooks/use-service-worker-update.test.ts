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

  it("polls for a build that shipped while the tab sat untouched", async () => {
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

  it("does nothing where there is no service worker at all", () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    const { result } = renderHook(() => useServiceWorkerUpdate());
    expect(result.current.updateAvailable).toBe(false);
    expect(() => result.current.applyUpdate()).not.toThrow();
  });
});
