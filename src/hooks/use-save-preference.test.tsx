import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { useSavePreference } from "@/hooks/use-save-preference";

const mocks = vi.hoisted(() => ({ setUser: vi.fn(), showToast: vi.fn() }));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: {}, setUser: mocks.setUser }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

const wrapper = ({ children }: { children: ReactNode }) => children;

const save = () => renderHook(() => useSavePreference(), { wrapper }).result.current;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a successful save", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  });

  it("applies the value immediately, before the request settles", async () => {
    const savePreference = save();
    await act(async () => {
      await savePreference("emailBillReminders", true, false, "email bill reminders");
    });
    expect(mocks.setUser).toHaveBeenCalledWith({ emailBillReminders: true });
  });

  it("sends only the one field being changed", async () => {
    const savePreference = save();
    await act(async () => {
      await savePreference("telegramDailyPromptTime", "20:00", "19:00", "the prompt time");
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/preferences");
    expect(JSON.parse(String(init!.body))).toEqual({ telegramDailyPromptTime: "20:00" });
  });

  it("does not roll back or complain", async () => {
    const savePreference = save();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await savePreference("emailBillReminders", true, false, "email bill reminders");
    });
    expect(ok).toBe(true);
    expect(mocks.setUser).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});

// The bug this hook exists for: the value flipped, flipped back, and nothing said why - which
// reads as the control being broken rather than the save failing.
describe("a rejected save", () => {
  it("rolls back and says so", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400 } as Response);
    const savePreference = save();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await savePreference("telegramDailyPrompt", true, false, "the Telegram evening prompt");
    });

    expect(ok).toBe(false);
    expect(mocks.setUser).toHaveBeenNthCalledWith(1, { telegramDailyPrompt: true });
    expect(mocks.setUser).toHaveBeenNthCalledWith(2, { telegramDailyPrompt: false });
    expect(mocks.showToast).toHaveBeenCalledWith(
      "Could not save the Telegram evening prompt. Please try again.",
      "error"
    );
  });

  it("restores the previous value, not merely the opposite of the new one", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    const savePreference = save();
    await act(async () => {
      await savePreference("transactionLayout", "pagination", "infinite", "the transaction layout");
    });
    expect(mocks.setUser).toHaveBeenNthCalledWith(2, { transactionLayout: "infinite" });
  });
});

// The Preferences tab was missed on the first pass, and only a reviewer caught it. These pin the
// two keys it owns so a future narrowing of the union breaks a test rather than a settings page.
describe("covers both profile tabs", () => {
  it("saves the Preferences tab's own fields", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    const savePreference = save();

    await act(async () => {
      await savePreference("showDayName", false, true, "the day name setting");
      await savePreference("dayNameFormat", "FULL", "SHORT", "the day name format");
    });

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body))).toEqual({ showDayName: false });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]!.body))).toEqual({ dayNameFormat: "FULL" });
  });
});

describe("a request that never arrives", () => {
  // Different advice on purpose: telling someone to check their connection when the server
  // rejected the value sends them to look at the wrong thing.
  it("rolls back and points at the connection instead", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const savePreference = save();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await savePreference("receiptScanEnabled", true, false, "receipt scanning");
    });

    expect(ok).toBe(false);
    expect(mocks.setUser).toHaveBeenNthCalledWith(2, { receiptScanEnabled: false });
    expect(mocks.showToast).toHaveBeenCalledWith(
      "Could not save receipt scanning. Check your connection.",
      "error"
    );
  });

  it("never throws, so the caller's saving flag is always cleared", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const savePreference = save();
    await expect(
      act(async () => {
        await savePreference("emailBillReminders", true, false, "email bill reminders");
      })
    ).resolves.not.toThrow();
  });
});
