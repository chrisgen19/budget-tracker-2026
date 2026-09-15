import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCardPurchaseBatch, type PurchaseBatchResult } from "@/hooks/use-card-purchase-batch";
import type { CardPurchasePayload } from "@/hooks/use-credit-accounts";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

const purchase = (amount: number): CardPurchasePayload => ({
  amount,
  description: "Google One",
  type: "EXPENSE",
  date: "2026-08-25T04:00:00.000Z",
  categoryId: "subs",
  labelIds: [],
  creditAccountId: "card-1",
});

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let fetchMock: ReturnType<typeof vi.fn>;
const sentBodies = () =>
  fetchMock.mock.calls.map(
    (call) => JSON.parse((call[1] as { body: string }).body) as { clientBatchId: string; transactions: unknown[] }
  );

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const setup = () => renderHook(() => useCardPurchaseBatch(), { wrapper: createWrapper() });

describe("useCardPurchaseBatch", () => {
  it("pins the rows after a lost response, and retries exactly them under the same key", async () => {
    const { result } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    let outcome: PurchaseBatchResult | null = null;
    await act(async () => {
      outcome = await result.current.submit([purchase(1111)]);
    });
    expect(outcome).toEqual({ outcome: "unconfirmed", firstDate: "2026-08-25T04:00:00.000Z" });
    expect(result.current.unconfirmed).toEqual([purchase(1111)]);

    fetchMock.mockResolvedValueOnce(respond(200, { transactions: [{ id: "tx-1" }] }));
    await act(async () => {
      outcome = await result.current.retry();
    });
    expect(outcome).toEqual({ outcome: "saved", count: 1, firstDate: "2026-08-25T04:00:00.000Z" });
    expect(result.current.unconfirmed).toBeNull();

    const [first, second] = sentBodies();
    expect(second).toEqual(first);
  });

  it("treats a server error as unconfirmed, since the batch may have committed behind it", async () => {
    const { result } = setup();
    fetchMock.mockResolvedValueOnce(respond(502, null));
    let outcome: PurchaseBatchResult | null = null;
    await act(async () => {
      outcome = await result.current.submit([purchase(1111)]);
    });
    expect(outcome).toMatchObject({ outcome: "unconfirmed" });
  });

  // A server that stays down must not leave the card's Add Purchases stuck on the retry screen.
  it("discards a pinned batch, and saves what is entered next under a new key", async () => {
    const { result } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(async () => {
      await result.current.submit([purchase(1111)]);
    });
    expect(result.current.unconfirmed).not.toBeNull();

    act(() => {
      result.current.discard();
    });
    expect(result.current.unconfirmed).toBeNull();

    fetchMock.mockResolvedValueOnce(respond(201, { transactions: [{ id: "tx-2" }] }));
    await act(async () => {
      await result.current.submit([purchase(1111)]);
    });
    const [abandoned, reentered] = sentBodies();
    expect(reentered.clientBatchId).not.toBe(abandoned.clientBatchId);
  });

  it("leaves the lines editable after a refusal, with the server's reason", async () => {
    const { result } = setup();
    fetchMock.mockResolvedValueOnce(respond(400, { error: "That credit card is archived" }));
    let outcome: PurchaseBatchResult | null = null;
    await act(async () => {
      outcome = await result.current.submit([purchase(1111)]);
    });
    expect(outcome).toEqual({ outcome: "refused", message: "That credit card is archived" });
    expect(result.current.unconfirmed).toBeNull();
  });

  it("uses a fresh key for the next statement once one is saved", async () => {
    const { result } = setup();
    fetchMock.mockResolvedValue(respond(201, { transactions: [{ id: "tx-1" }] }));
    await act(async () => {
      await result.current.submit([purchase(1111)]);
    });
    await act(async () => {
      await result.current.submit([purchase(250)]);
    });

    const [first, second] = sentBodies();
    expect(first.clientBatchId).toBeTruthy();
    expect(second.clientBatchId).not.toBe(first.clientBatchId);
  });
});
