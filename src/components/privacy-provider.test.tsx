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
