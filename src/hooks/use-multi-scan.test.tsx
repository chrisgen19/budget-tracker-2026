import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { UserProvider } from "@/components/user-provider";
import { useMultiScan } from "@/hooks/use-multi-scan";

// compressImage draws to a canvas, which jsdom cannot do — the image never loads and the
// promise never settles. The hook's own logic is what is under test here.
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  compressImage: vi.fn(async (file: File) => file),
}));

const receipt = (name = "receipt.jpg") =>
  new File(["x"], name, { type: "image/jpeg", lastModified: Date.parse("2026-08-01T10:00:00Z") });

const scanOk = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    amount: 120,
    description: "Merchant",
    type: "EXPENSE",
    date: "2026-08-01",
    categoryId: "cat-food",
    multiCategory: false,
    dateWarning: false,
    usedPhotoFallback: false,
    ...overrides,
  }),
});

const scanErr = (status: number, error: string) => ({
  ok: false,
  status,
  json: async () => ({ error }),
});

/** An error response that is not JSON at all, as an unhandled server fault returns. */
const scanHtmlFault = () => ({
  ok: false,
  status: 500,
  json: async () => {
    throw new SyntaxError("Unexpected token < in JSON");
  },
});

/** One client per setup() call. Building it inside the wrapper's render body would hand a
 *  fresh client to every re-render, discarding in-flight mutation state the moment any test
 *  calls rerender. */
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <UserProvider
          initialUser={{
            name: "Test",
            email: "test@example.com",
            currency: "PHP",
            // Deliberately differs from the test process (Asia/Shanghai, UTC+8).
            timezoneOffset: 420,
            receiptScanEnabled: true,
            transactionLayout: "infinite",
            transactionAmountAutofocus: true,
            defaultLabelType: "EXPENSE",
            telegramPromptAvailable: false,
            telegramDailyPrompt: false,
            telegramDailyPromptTime: "20:00",
            showDayName: true,
            dayNameFormat: "SHORT",
            emailBillReminders: false,
            emailVerified: true,
            role: "FREE",
            roleScanEnabled: true,
            maxUploadFiles: 10,
            monthlyScanLimit: 5,
            scansUsedThisMonth: 0,
          }}
        >
          <ToastProvider>{children}</ToastProvider>
        </UserProvider>
      </QueryClientProvider>
    );
  };
};

const setup = () => renderHook(() => useMultiScan(), { wrapper: createWrapper() });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("TZ", "UTC");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("scanSingle", () => {
  it("reports success and leaves the review modal for the caller to open", async () => {
    fetchMock.mockResolvedValue(scanOk());
    const { result } = setup();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.scanSingle(receipt());
    });

    expect(ok).toBe(true);
    // The caller opens the review so that closing the sheet batches into the same render;
    // splitting them leaves both modals mounted and drops the review's scroll lock.
    expect(result.current.showReview).toBe(false);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].status).toBe("success");
  });

  it("uses the account clock for a scanned receipt date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T00:30:00.000Z"));
    fetchMock.mockResolvedValue(scanOk({ date: "2026-08-28" }));
    const { result } = setup();

    await act(async () => {
      await result.current.scanSingle(receipt());
    });

    expect(result.current.items[0].data?.date).toBe("2026-08-28T17:30");
  });

  it("reports failure rather than reading the row back out of state", async () => {
    // patchItem only schedules a render, so inspecting the item straight after awaiting the
    // scan saw the stale "scanning" status and treated a failed scan as a success.
    fetchMock.mockResolvedValue(scanErr(422, "This doesn't look like a receipt."));
    const { result } = setup();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.scanSingle(receipt());
    });

    expect(ok).toBe(false);
    expect(result.current.showReview).toBe(false);
    expect(result.current.scanError).toBe("This doesn't look like a receipt.");
  });

  it("distinguishes an unreadable image from a network failure", async () => {
    const { compressImage } = await import("@/lib/utils");
    vi.mocked(compressImage).mockRejectedValueOnce(new Error("decode failed"));
    const { result } = setup();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.scanSingle(receipt());
    });

    expect(ok).toBe(false);
    expect(result.current.scanError).toMatch(/could not be read/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not report an HTML error page as a network problem", async () => {
    fetchMock.mockResolvedValue(scanHtmlFault());
    const { result } = setup();

    await act(async () => {
      await result.current.scanSingle(receipt());
    });

    expect(result.current.scanError).toBe("Failed to scan receipt.");
    expect(result.current.scanError).not.toMatch(/network/i);
  });
});

describe("scanMultiple", () => {
  it("keeps the compressed image on rows that failed, so they can be retried", async () => {
    fetchMock
      .mockResolvedValueOnce(scanOk())
      .mockResolvedValueOnce(scanErr(503, "The AI scanning service is busy right now."));
    const { result } = setup();

    await act(async () => {
      await result.current.scanMultiple([receipt("a.jpg"), receipt("b.jpg")]);
    });

    const failed = result.current.items.find((i) => i.status === "error");
    expect(failed).toBeDefined();
    expect(failed!.imageFile).toBeInstanceOf(File);
    expect(result.current.retryableCount).toBe(1);
    expect(result.current.unsavedCount).toBe(1);
  });

  it("re-scans a failed row on retry", async () => {
    fetchMock.mockResolvedValueOnce(scanErr(503, "Busy"));
    const { result } = setup();

    await act(async () => {
      await result.current.scanMultiple([receipt("a.jpg")]);
    });
    expect(result.current.items[0].status).toBe("error");

    fetchMock.mockResolvedValueOnce(scanOk());
    await act(async () => {
      await result.current.retryItem(result.current.items[0].id);
    });

    expect(result.current.items[0].status).toBe("success");
    expect(result.current.items[0].error).toBeUndefined();
    expect(result.current.retryableCount).toBe(0);
  });
});

describe("saveAll", () => {
  it("leaves the queue intact when the save fails", async () => {
    fetchMock.mockResolvedValueOnce(scanOk());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt()]);
    });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await act(async () => {
      await result.current.saveAll();
    });

    // The old catch flipped every row to "error", whose only action is Delete — stranding
    // the data and the scan credits behind a UI that could not save them.
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].status).toBe("success");
    expect(result.current.showReview).toBe(true);
  });

  it("keeps failed rows in the review after saving the successful ones", async () => {
    fetchMock
      .mockResolvedValueOnce(scanOk())
      .mockResolvedValueOnce(scanErr(503, "Busy"));
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt("a.jpg"), receipt("b.jpg")]);
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ transactions: [] }),
    });
    await act(async () => {
      await result.current.saveAll();
    });

    // Resetting the whole queue here discarded the failed row's retained image, removing
    // the only route back to it short of re-picking the file.
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].status).toBe("error");
    expect(result.current.retryableCount).toBe(1);
    expect(result.current.showReview).toBe(true);
  });

  it("closes the review when every row saved", async () => {
    fetchMock.mockResolvedValueOnce(scanOk());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt()]);
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ transactions: [] }),
    });
    await act(async () => {
      await result.current.saveAll();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(0));
    expect(result.current.showReview).toBe(false);
  });
});

describe("response validation", () => {
  it("rejects a 200 that is missing required fields instead of marking it success", async () => {
    // An unchecked cast let this become a success row holding undefined, which saveAll then
    // asserted non-null and posted — and the server rejected the whole atomic batch.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ description: "Merchant", type: "EXPENSE", usedPhotoFallback: false }),
    });
    const { result } = setup();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.scanSingle(receipt());
    });

    expect(ok).toBe(false);
    expect(result.current.scanError).toMatch(/unexpected result/i);
  });

  it("does not throw on a missing date when the photo fallback was not used", async () => {
    // withLocalTime(undefined) threw on .slice and surfaced as a network error.
    fetchMock.mockResolvedValue(
      scanOk({ date: undefined, usedPhotoFallback: false }),
    );
    const { result } = setup();

    await act(async () => {
      await result.current.scanSingle(receipt());
    });

    expect(result.current.scanError).not.toMatch(/network/i);
    expect(result.current.scanError).toMatch(/unexpected result/i);
  });

  it("accepts a response whose date is supplied by the photo fallback", async () => {
    fetchMock.mockResolvedValue(scanOk({ date: undefined, usedPhotoFallback: true }));
    const { result } = setup();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.scanSingle(receipt());
    });

    expect(ok).toBe(true);
    expect(result.current.items[0].data?.date).toBe("2026-08-01T03:00");
  });
});

describe("compression failures in a batch", () => {
  it("marks the row unreadable rather than uploading the original", async () => {
    const { compressImage } = await import("@/lib/utils");
    vi.mocked(compressImage)
      .mockRejectedValueOnce(new Error("decode failed"))
      .mockImplementationOnce(async (f: File) => f);
    fetchMock.mockResolvedValue(scanOk());
    const { result } = setup();

    await act(async () => {
      await result.current.scanMultiple([receipt("broken.jpg"), receipt("ok.jpg")]);
    });

    const broken = result.current.items.find((i) => i.fileName === "broken.jpg");
    expect(broken!.status).toBe("error");
    expect(broken!.error).toMatch(/could not be read/i);
    // No image retained, so no Retry is offered: re-compressing it would fail identically.
    expect(broken!.imageFile).toBeUndefined();
    expect(result.current.retryableCount).toBe(0);

    // The healthy file still scanned, and only it was uploaded.
    expect(result.current.items.find((i) => i.fileName === "ok.jpg")!.status).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("batch idempotency key", () => {
  const bodyOf = (call: unknown[]) =>
    JSON.parse((call[1] as { body: string }).body) as { clientBatchId?: string };

  it("reuses the key when a failed save is retried, so the retry replays", async () => {
    fetchMock.mockResolvedValueOnce(scanOk());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt()]);
    });

    // A batch can commit and still lose its response. Retrying with a fresh key would
    // post the same receipts a second time.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await act(async () => {
      await result.current.saveAll();
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ transactions: [] }),
    });
    await act(async () => {
      await result.current.saveAll();
    });

    const saves = fetchMock.mock.calls.filter(
      (c) => (c[0] as string) === "/api/transactions/batch",
    );
    expect(saves).toHaveLength(2);
    expect(bodyOf(saves[0]).clientBatchId).toBeTruthy();
    expect(bodyOf(saves[1]).clientBatchId).toBe(bodyOf(saves[0]).clientBatchId);
  });

  it("resends the original rows, not a grown queue, when a failed save is retried", async () => {
    // The reported sequence: a mixed batch is submitted, the server commits it but the
    // response is lost, the user retries the failed scan, then saves again. Rebuilding the
    // payload from the live queue under the same key made the server replay only the
    // original rows while the client marked the newly scanned one saved — losing it.
    fetchMock
      .mockResolvedValueOnce(scanOk())
      .mockResolvedValueOnce(scanErr(503, "Busy"));
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt("a.jpg"), receipt("b.jpg")]);
    });
    expect(result.current.unsavedCount).toBe(1);

    // Save the one good row. It commits server-side but the response is lost.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await act(async () => {
      await result.current.saveAll();
    });

    // The user retries the failed scan and it now succeeds, so the queue has grown.
    fetchMock.mockResolvedValueOnce(scanOk());
    await act(async () => {
      await result.current.retryItem(
        result.current.items.find((i) => i.status === "error")!.id,
      );
    });
    expect(result.current.unsavedCount).toBe(2);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ transactions: [] }),
    });
    await act(async () => {
      await result.current.saveAll();
    });

    const saves = fetchMock.mock.calls.filter(
      (c) => (c[0] as string) === "/api/transactions/batch",
    );
    const firstBody = JSON.parse((saves[0][1] as { body: string }).body);
    const retryBody = JSON.parse((saves[1][1] as { body: string }).body);

    // Same key, and the same single row it originally carried.
    expect(retryBody.clientBatchId).toBe(firstBody.clientBatchId);
    expect(retryBody.transactions).toHaveLength(1);

    // The receipt scanned after the batch went out is still queued, not silently dropped.
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.unsavedCount).toBe(1);
    expect(result.current.showReview).toBe(true);
  });

  it("gives the leftover rows a fresh key on the following save", async () => {
    fetchMock.mockResolvedValueOnce(scanOk()).mockResolvedValueOnce(scanOk());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt("a.jpg"), receipt("b.jpg")]);
    });

    // Remove one so the first save carries a single row, then fail it ambiguously.
    act(() => {
      result.current.removeItem(result.current.items[1].id);
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await act(async () => {
      await result.current.saveAll();
    });

    // Replay acknowledges the pinned batch and clears the queue.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ transactions: [] }),
    });
    await act(async () => {
      await result.current.saveAll();
    });

    // A subsequent save must not reuse the acknowledged key, or it would replay as a no-op.
    fetchMock.mockResolvedValueOnce(scanOk());
    await act(async () => {
      await result.current.scanMultiple([receipt("c.jpg")]);
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ transactions: [] }),
    });
    await act(async () => {
      await result.current.saveAll();
    });

    const saves = fetchMock.mock.calls.filter(
      (c) => (c[0] as string) === "/api/transactions/batch",
    );
    const keys = saves.map((c) => JSON.parse((c[1] as { body: string }).body).clientBatchId);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("uses a fresh key for a save that follows a successful one", async () => {
    fetchMock.mockResolvedValueOnce(scanOk());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt()]);
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ transactions: [] }),
    });
    await act(async () => {
      await result.current.saveAll();
    });

    fetchMock.mockResolvedValueOnce(scanOk());
    await act(async () => {
      await result.current.scanMultiple([receipt("second.jpg")]);
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ transactions: [] }),
    });
    await act(async () => {
      await result.current.saveAll();
    });

    const saves = fetchMock.mock.calls.filter(
      (c) => (c[0] as string) === "/api/transactions/batch",
    );
    expect(saves).toHaveLength(2);
    // A distinct save is a distinct intent; sharing the key would make the second a replay
    // of the first and silently drop the receipt.
    expect(bodyOf(saves[1]).clientBatchId).not.toBe(bodyOf(saves[0]).clientBatchId);
  });
});

describe("labels survive a second edit", () => {
  it("keeps labels when a later edit omits labelIds", async () => {
    fetchMock.mockResolvedValueOnce(scanOk());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt()]);
    });
    const id = result.current.items[0].id;

    act(() => {
      result.current.updateItem(id, { ...result.current.items[0].data, labelIds: ["lbl-1"] });
    });
    expect(result.current.items[0].data?.labelIds).toEqual(["lbl-1"]);

    // Exactly what AppShell forwards after TransactionForm omitted labelIds: the key is
    // present and undefined. updateItem must drop it rather than write over the selection.
    act(() => {
      result.current.updateItem(id, { description: "Renamed", labelIds: undefined });
    });

    expect(result.current.items[0].data?.description).toBe("Renamed");
    expect(result.current.items[0].data?.labelIds).toEqual(["lbl-1"]);
  });

  it("keeps an explicit opt-out distinct from never choosing", async () => {
    fetchMock.mockResolvedValueOnce(scanOk());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt()]);
    });
    const id = result.current.items[0].id;

    // [] means the user opted out; undefined means the server auto-applies. Dropping
    // undefined must not also drop an explicit [], or the two collapse into one.
    act(() => {
      result.current.updateItem(id, { labelIds: [] });
    });
    expect(result.current.items[0].data?.labelIds).toEqual([]);

    act(() => {
      result.current.updateItem(id, { description: "Renamed", labelIds: undefined });
    });
    expect(result.current.items[0].data?.labelIds).toEqual([]);
  });

  it("still writes an explicit empty selection", async () => {
    fetchMock.mockResolvedValueOnce(scanOk());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt()]);
    });
    const id = result.current.items[0].id;

    act(() => {
      result.current.updateItem(id, { labelIds: ["lbl-1"] });
    });
    act(() => {
      result.current.updateItem(id, { labelIds: [] });
    });

    expect(result.current.items[0].data?.labelIds).toEqual([]);
  });
});

describe("queue is frozen during a save", () => {
  const multiCategoryScan = () =>
    scanOk({
      multiCategory: true,
      breakdown: [
        {
          amount: 70,
          categoryId: "cat-food",
          description: "Groceries",
          lineItems: [{ name: "Rice", amount: 70 }],
        },
        {
          amount: 50,
          categoryId: "cat-household",
          description: "Cleaning",
          lineItems: [{ name: "Bleach", amount: 50 }],
        },
      ],
    });

  it("ignores itemize while Save All is in flight, so the receipt is not created twice", async () => {
    fetchMock.mockResolvedValueOnce(multiCategoryScan());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt()]);
    });

    const parentId = result.current.items[0].id;
    expect(result.current.items[0].data?.multiCategory).toBe(true);

    // Hold the batch request open so the save is genuinely mid-flight.
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementationOnce(async () => {
      await inFlight;
      return { ok: true, status: 201, json: async () => ({ transactions: [] }) };
    });

    let savePromise!: Promise<void>;
    await act(async () => {
      savePromise = result.current.saveAll();
      await Promise.resolve();
    });

    // Expanding the submitted parent here would leave its children outside savedIds, so
    // they would survive the save and the next Save All would recreate the same expenses.
    await act(async () => {
      await result.current.itemizeItem(parentId);
    });
    expect(result.current.items.map((i) => i.id)).toEqual([parentId]);

    await act(async () => {
      release();
      await savePromise;
    });

    // The parent saved and nothing was left behind to be posted a second time.
    expect(result.current.items).toHaveLength(0);
    expect(result.current.showReview).toBe(false);
  });

  it("allows itemize again after a save that definitively wrote nothing", async () => {
    fetchMock.mockResolvedValueOnce(multiCategoryScan());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt()]);
    });

    // 4xx is raised before the route opens a transaction, so nothing was written and the
    // queue is free to be corrected.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
    await act(async () => {
      await result.current.saveAll();
    });
    expect(result.current.unconfirmedIds.size).toBe(0);

    await act(async () => {
      await result.current.itemizeItem(result.current.items[0].id);
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.every((i) => i.parentId !== undefined)).toBe(true);
  });

  it("keeps rows frozen after a save whose outcome is unknown", async () => {
    fetchMock.mockResolvedValueOnce(multiCategoryScan());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt()]);
    });
    const id = result.current.items[0].id;

    // A 5xx may be our own rollback or a proxy that lost the response of a committed
    // batch. The retry replays these exact rows, so editing them would be discarded.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
    await act(async () => {
      await result.current.saveAll();
    });

    expect(result.current.unconfirmedIds.has(id)).toBe(true);

    await act(async () => {
      await result.current.itemizeItem(id);
    });
    expect(result.current.items).toHaveLength(1);

    act(() => {
      result.current.updateItem(id, { ...result.current.items[0].data, amount: 999 });
    });
    expect(result.current.items[0].data?.amount).not.toBe(999);

    act(() => {
      result.current.removeItem(id);
    });
    expect(result.current.items).toHaveLength(1);
  });

  it("unfreezes the rows once the replay is acknowledged", async () => {
    fetchMock.mockResolvedValueOnce(scanOk());
    const { result } = setup();
    await act(async () => {
      await result.current.scanMultiple([receipt()]);
    });

    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
    await act(async () => {
      await result.current.saveAll();
    });
    expect(result.current.unconfirmedIds.size).toBe(1);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ transactions: [] }),
    });
    await act(async () => {
      await result.current.saveAll();
    });

    expect(result.current.unconfirmedIds.size).toBe(0);
    expect(result.current.items).toHaveLength(0);
  });
});

describe("discard accounting", () => {
  it("counts retryable rows, so an all-failed batch still warns before closing", async () => {
    fetchMock.mockResolvedValue(scanErr(503, "Busy"));
    const { result } = setup();

    await act(async () => {
      await result.current.scanMultiple([receipt("a.jpg"), receipt("b.jpg")]);
    });

    // unsavedCount alone is 0 here, which let a close bypass the confirmation entirely
    // and destroy the retry queue on Escape or a swipe-down.
    expect(result.current.unsavedCount).toBe(0);
    expect(result.current.retryableCount).toBe(2);
  });
});
