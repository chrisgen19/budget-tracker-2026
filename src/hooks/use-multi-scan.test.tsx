import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const wrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider
        initialUser={{
          name: "Test",
          email: "test@example.com",
          currency: "PHP",
          timezoneOffset: -480,
          receiptScanEnabled: true,
          transactionLayout: "infinite",
          transactionAmountAutofocus: true,
          defaultLabelType: "EXPENSE",
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

const setup = () => renderHook(() => useMultiScan(), { wrapper });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
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
