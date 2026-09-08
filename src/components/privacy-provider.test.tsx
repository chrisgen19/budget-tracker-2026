import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { PrivacyProvider, usePrivacy } from "@/components/privacy-provider";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <PrivacyProvider>{children}</PrivacyProvider>
);

/** The provider loads the current value on mount before anything else happens. */
const mountedHook = async () => {
  const hook = renderHook(() => usePrivacy(), { wrapper });
  await waitFor(() => expect(hook.result.current.hideAmounts).toBe(false));
  vi.mocked(fetch).mockClear();
  return hook;
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hideAmounts: false }) } as Response)
  );
});

afterEach(() => vi.unstubAllGlobals());

/** A user who asked for hiding saw the real figures until the fetch landed - a flash of the exact
 *  thing the setting exists to hide. The layout reads the preference server-side and seeds it. */
describe("the starting value", () => {
  it("uses the server-rendered preference before the fetch resolves", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as Promise<Response>);

    const { result } = renderHook(() => usePrivacy(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PrivacyProvider initialHideAmounts>{children}</PrivacyProvider>
      ),
    });

    expect(result.current.hideAmounts).toBe(true);
  });

  it("falls back to showing amounts when nothing was passed", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}) as Promise<Response>);

    const { result } = renderHook(() => usePrivacy(), { wrapper });

    expect(result.current.hideAmounts).toBe(false);
  });

  it("still reconciles with the stored value on mount", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ hideAmounts: false }),
    } as Response);

    const { result } = renderHook(() => usePrivacy(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PrivacyProvider initialHideAmounts>{children}</PrivacyProvider>
      ),
    });

    await waitFor(() => expect(result.current.hideAmounts).toBe(false));
  });
});

/**
 * The mount read and a press can overlap, and the press has to win.
 *
 * The control sits in the app chrome now, on screen from the first paint, so pressing it while
 * the mount GET is still in flight is an ordinary thing to do rather than a contrived one. The
 * PATCH stores the new value, then the older GET resolves carrying the old one and puts it back.
 * Re-hiding is merely confusing; the other direction puts amounts the user just hid back on
 * screen, which is the one thing this setting exists to stop.
 */
describe("a toggle racing the mount read", () => {
  /** Resolves the mount GET by hand, so the toggle lands while it is still in flight. */
  const deferredMountRead = () => {
    let settle: (value: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise<Response>((resolve) => (settle = resolve))
    );
    return (hideAmounts: boolean) =>
      settle({ ok: true, json: async () => ({ hideAmounts }) } as Response);
  };

  it("keeps the amounts hidden when a stale read says to show them", async () => {
    const landMountRead = deferredMountRead();
    const { result } = renderHook(() => usePrivacy(), { wrapper });

    await act(async () => {
      await result.current.toggleHideAmounts();
    });
    expect(result.current.hideAmounts).toBe(true);

    await act(async () => landMountRead(false));

    expect(result.current.hideAmounts).toBe(true);
  });

  it("keeps the amounts shown when a stale read says to hide them", async () => {
    const landMountRead = deferredMountRead();
    const { result } = renderHook(() => usePrivacy(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PrivacyProvider initialHideAmounts>{children}</PrivacyProvider>
      ),
    });

    await act(async () => {
      await result.current.toggleHideAmounts();
    });
    expect(result.current.hideAmounts).toBe(false);

    await act(async () => landMountRead(true));

    expect(result.current.hideAmounts).toBe(false);
  });
});

/**
 * Two presses inside one round trip must reach the server in the order they were made.
 *
 * `PATCH /api/preferences` ends in an unconditional `prisma.user.update`, so unordered writes
 * commit in whatever order they arrive: the database can be left holding the value the user
 * pressed away from, and the next load resolves the disagreement the wrong way.
 */
describe("two presses inside one round trip", () => {
  const bodyOf = (call: number) =>
    JSON.parse(String((vi.mocked(fetch).mock.calls[call][1] as RequestInit).body));

  it("holds the second write until the first has settled, then sends the later value", async () => {
    const { result } = await mountedHook();

    let settleFirstWrite: () => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          settleFirstWrite = () => resolve({ ok: true } as Response);
        })
    );

    // Awaited so each queued write reaches its microtask. The presses are fire-and-forget: the
    // context types the toggle as `() => void`, and neither call settles until the first
    // response lands anyway.
    await act(async () => {
      result.current.toggleHideAmounts();
    });
    await act(async () => {
      result.current.toggleHideAmounts();
    });

    // The second press applied on screen, but its write is queued rather than racing.
    expect(result.current.hideAmounts).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodyOf(0)).toEqual({ hideAmounts: true });

    await act(async () => settleFirstWrite());

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(bodyOf(1)).toEqual({ hideAmounts: false });
    expect(result.current.hideAmounts).toBe(false);
  });

  it("does not strand a later press behind a failed one", async () => {
    const { result } = await mountedHook();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      await result.current.toggleHideAmounts();
    });
    await act(async () => {
      await result.current.toggleHideAmounts();
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

/**
 * A rollback has to land on a value the server actually confirmed.
 *
 * Rolling back to "whatever this press flipped away from" is only correct while that value was
 * itself confirmed. Queue two presses and fail both, and the second rolls back to the *first*
 * press's optimistic value - one the database never accepted - so the screen ends up inverted
 * against storage.
 */
describe("two queued writes that both fail", () => {
  /** Fails the first write on demand, so the second press lands while it is still in flight. */
  const deferredFailure = () => {
    let fail: () => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise<Response>((_, reject) => (fail = () => reject(new Error("offline"))))
    );
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    // Wrapped rather than returned directly: the executor that assigns `fail` does not run until
    // `fetch` is first called, so returning it here would hand back the placeholder.
    return () => fail();
  };

  const pressTwiceAndFailBoth = async (result: { current: ReturnType<typeof usePrivacy> }) => {
    const failFirstWrite = deferredFailure();

    await act(async () => {
      result.current.toggleHideAmounts();
    });
    await act(async () => {
      result.current.toggleHideAmounts();
    });

    await act(async () => failFirstWrite());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  };

  it("settles on the stored value rather than the first press's guess", async () => {
    const { result } = await mountedHook();

    await pressTwiceAndFailBoth(result);

    expect(result.current.hideAmounts).toBe(false);
  });

  /** The direction that matters: nothing was saved, so the amounts must stay hidden. */
  it("does not end up showing amounts the database still hides", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ hideAmounts: true }),
    } as Response);

    const { result } = renderHook(() => usePrivacy(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PrivacyProvider initialHideAmounts>{children}</PrivacyProvider>
      ),
    });
    await waitFor(() => expect(result.current.hideAmounts).toBe(true));
    vi.mocked(fetch).mockClear();

    await pressTwiceAndFailBoth(result);

    expect(result.current.hideAmounts).toBe(true);
  });
});

describe("toggling hidden amounts", () => {
  it("applies the new value and keeps it when the save lands", async () => {
    const { result } = await mountedHook();

    await act(async () => {
      await result.current.toggleHideAmounts();
    });

    expect(result.current.hideAmounts).toBe(true);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  // This checked nothing at all before: the switch flipped, the request went out, and a failure
  // left the UI disagreeing with the database until the next reload - so amounts could read as
  // hidden on a page that would show them again on refresh.
  it("puts the value back and says so when the server refuses", async () => {
    const { result } = await mountedHook();
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    await act(async () => {
      await result.current.toggleHideAmounts();
    });

    expect(result.current.hideAmounts).toBe(false);
    expect(mocks.showToast).toHaveBeenCalledWith("Could not save that. Please try again.", "error");
  });

  it("puts the value back and points at the connection when the request fails", async () => {
    const { result } = await mountedHook();
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));

    await act(async () => {
      await result.current.toggleHideAmounts();
    });

    expect(result.current.hideAmounts).toBe(false);
    expect(mocks.showToast).toHaveBeenCalledWith("Could not save that. Check your connection.", "error");
  });
});
