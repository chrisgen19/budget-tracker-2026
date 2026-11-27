import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { receiptPhotoKeys } from "@/hooks/use-receipt-photos";
import {
  useBulkDeleteTransactions,
  useBulkUpdateTransactions,
  useDeleteTransaction,
  useUpdateTransaction,
} from "@/hooks/use-transactions";
import type { TransactionInput } from "@/lib/validations";

/**
 * The photo viewer lists the rows a photo is on and their total, both derived from transactions.
 * Without invalidation, an edit or delete left them stale for the 5-minute staleTime: a deleted
 * row still listed, an old amount still summed.
 */

const TX = {
  id: "tx-1",
  amount: 10,
  description: "SM Supermarket",
  type: "EXPENSE",
  date: "2026-11-26T00:00:00.000Z",
  categoryId: "food",
  category: { id: "food", name: "Food" },
  labels: [],
};

const respondWith = (body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)),
  );

const seededClient = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(receiptPhotoKeys.info("photo-1"), { photo: { id: "photo-1" }, transactions: [], total: 0 });
  return client;
};

const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const infoIsStale = (client: QueryClient) =>
  client.getQueryState(receiptPhotoKeys.info("photo-1"))?.isInvalidated;

afterEach(() => vi.unstubAllGlobals());

describe("transaction writes invalidate cached receipt photo info", () => {
  it("on update", async () => {
    const client = seededClient();
    respondWith(TX);
    const { result } = renderHook(() => useUpdateTransaction(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({ id: "tx-1", input: { amount: 12 } as TransactionInput });
    });

    expect(infoIsStale(client)).toBe(true);
  });

  it("on delete", async () => {
    const client = seededClient();
    respondWith({});
    const { result } = renderHook(() => useDeleteTransaction(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync("tx-1");
    });

    expect(infoIsStale(client)).toBe(true);
  });

  it("on bulk delete", async () => {
    const client = seededClient();
    respondWith({ deleted: 1, ids: ["tx-1"] });
    const { result } = renderHook(() => useBulkDeleteTransactions(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(["tx-1"]);
    });

    expect(infoIsStale(client)).toBe(true);
  });

  it("on bulk update", async () => {
    const client = seededClient();
    respondWith({ updated: 1, ids: ["tx-1"] });
    const { result } = renderHook(() => useBulkUpdateTransactions(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({ ids: ["tx-1"], categoryId: "food" } as never);
    });

    expect(infoIsStale(client)).toBe(true);
  });
});
