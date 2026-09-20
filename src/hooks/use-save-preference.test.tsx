import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { analyticsKeys } from "@/hooks/use-analytics";
import { useSavePreference } from "@/hooks/use-save-preference";

const mocks = vi.hoisted(() => ({ setUser: vi.fn(), showToast: vi.fn() }));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: {}, setUser: mocks.setUser }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

// A real client rather than a mocked `useQueryClient`: the assertion worth making is that the
// Watchlist's own cache namespace is the one invalidated, and a mock cannot tell a correct key
// from a plausible one.
let queryClient: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const save = () => renderHook(() => useSavePreference(), { wrapper }).result.current;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidate = vi.spyOn(queryClient, "invalidateQueries");
});

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
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

/**
 * The facts query is keyed by user and period only, with a five-minute `staleTime`, so nothing
 * about a threshold change reaches it on its own. Saving one and going straight to the Watchlist -
 * the whole reason to change one - showed findings computed with the old value.
 */
describe("a threshold the Watchlist is computed from", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  });

  it.each([
    ["watchlistOutlierRatio", 5, 3],
    ["watchlistLargeAmount", 10_000, null],
    ["watchlistDuplicateAlerts", false, true],
  ] as const)("drops the cached findings after saving %s", async (key, next, previous) => {
    const savePreference = save();
    await act(async () => {
      await savePreference(key, next, previous, "a Watchlist setting");
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: analyticsKeys.all });
  });

  // A rollback leaves the cache agreeing with the database, so a refetch would arrive back where
  // it started - and would do it while a toast says the save failed.
  it("leaves the cache alone when the server refused the value", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400 } as Response);
    const savePreference = save();
    await act(async () => {
      await savePreference("watchlistOutlierRatio", 5, 3, "the unusual-charge threshold");
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  // Nothing else on the profile page feeds the assessment, so invalidating for every preference
  // would refetch the analytics page because somebody changed a date format.
  it("does not refetch analytics for a preference it is not computed from", async () => {
    const savePreference = save();
    await act(async () => {
      await savePreference("dayNameFormat", "FULL", "SHORT", "the day name format");
    });
    expect(invalidate).not.toHaveBeenCalled();
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
