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
