import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRefusedError } from "@/hooks/api-error";
import { receiptPhotoUrl, uploadReceiptPhoto, useReceiptPhotoInfo } from "@/hooks/use-receipt-photos";

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const photo = { id: "p1", width: 800, height: 1200, byteSize: 5000, createdAt: "2026-11-26T00:00:00.000Z" };

describe("receiptPhotoUrl", () => {
  it("points at the owner-checked image route", () => {
    expect(receiptPhotoUrl("abc")).toBe("/api/receipt-photos/abc");
  });
});

describe("uploadReceiptPhoto", () => {
  it("posts photo and photoKey as multipart form data and returns the photo", async () => {
    fetchMock.mockResolvedValueOnce(respond(201, { photo }));
    const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
    const result = await uploadReceiptPhoto(file, "key-1");
    expect(result).toEqual(photo);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: FormData }];
    expect(url).toBe("/api/receipt-photos");
    expect(init.method).toBe("POST");
    expect(init.body.get("photoKey")).toBe("key-1");
    expect((init.body.get("photo") as File).name).toBe("r.jpg");
  });

  it("rejects with the refusal carrying the status on a 503", async () => {
    fetchMock.mockResolvedValueOnce(respond(503, { error: "Not configured", code: "PHOTOS_DISABLED" }));
    const file = new File(["x"], "r.jpg", { type: "image/jpeg" });
    const err = await uploadReceiptPhoto(file, "key-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRefusedError);
    expect((err as ApiRefusedError).status).toBe(503);
  });
});

describe("useReceiptPhotoInfo", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );

  it("makes no request when the id is null", () => {
    renderHook(() => useReceiptPhotoInfo(null), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the info route for an id", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { photo, transactions: [], total: 0 }));
    const { result } = renderHook(() => useReceiptPhotoInfo("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/receipt-photos/p1/info");
  });
});
