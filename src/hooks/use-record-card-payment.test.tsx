import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRecordCardPayment, type RecordPaymentResult } from "@/hooks/use-record-card-payment";
import type { CreditPaymentInput } from "@/lib/validations";

const MANILA = -480;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

const input = (over: Partial<CreditPaymentInput> = {}): CreditPaymentInput => ({
  kind: "PAYMENT",
  amount: 5000,
  description: "BPI app",
  date: "2026-09-14",
  ...over,
});

/** The row the server stores for `input()`: the start of 14 September in Manila. */
const savedRow = (over: Record<string, unknown> = {}) => ({
  id: "pay-1",
  kind: "PAYMENT",
  amount: 5000,
  description: "BPI app",
  date: "2026-09-13T16:00:00.000Z",
  ...over,
});

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let fetchMock: ReturnType<typeof vi.fn>;
const sentKeys = () =>
  fetchMock.mock.calls.map((call) => (JSON.parse((call[1] as { body: string }).body) as { clientRequestId?: string }).clientRequestId);

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

const setup = () => renderHook(() => useRecordCardPayment(MANILA), { wrapper: createWrapper() });

const record = async (result: { current: ReturnType<typeof useRecordCardPayment> }, value = input()) => {
  let outcome: RecordPaymentResult | null = null;
  await act(async () => {
    outcome = await result.current.submit("card-1", value);
  });
  return outcome as unknown as RecordPaymentResult;
};

describe("useRecordCardPayment", () => {
  it("retries a lost response under the same key, and reports the replayed payment as saved", async () => {
    const { result } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await record(result)).toEqual({ outcome: "unconfirmed" });

    fetchMock.mockResolvedValueOnce(respond(200, savedRow()));
    expect(await record(result)).toEqual({ outcome: "saved", payment: savedRow() });

    const [first, second] = sentKeys();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  it("treats a server error as unconfirmed, since the payment may have committed behind it", async () => {
    const { result } = setup();
    fetchMock.mockResolvedValueOnce(respond(502, null));

    expect(await record(result)).toEqual({ outcome: "unconfirmed" });
  });

  it("starts a new key once a payment is saved, so the next one is a new payment", async () => {
    const { result } = setup();
    fetchMock.mockResolvedValueOnce(respond(201, savedRow()));
    fetchMock.mockResolvedValueOnce(respond(201, savedRow({ id: "pay-2" })));

    await record(result);
    await record(result);

    const [first, second] = sentKeys();
    expect(second).not.toBe(first);
  });

  it("keeps the key after a refusal, since nothing was stored under it", async () => {
    const { result } = setup();
    fetchMock.mockResolvedValueOnce(respond(409, { error: "That card is archived" }));
    expect(await record(result)).toEqual({ outcome: "refused", message: "That card is archived" });

    fetchMock.mockResolvedValueOnce(respond(201, savedRow()));
    await record(result);

    const [first, second] = sentKeys();
    expect(second).toBe(first);
  });

  // The fields stay editable after "Couldn't confirm". If the first attempt did land, the edited
  // retry is answered with it, and saying "Payment recorded" would claim the edits were saved.
  it("says so when an edited retry was answered with the earlier attempt, and renews the key", async () => {
    const { result } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await record(result);

    fetchMock.mockResolvedValueOnce(respond(200, savedRow()));
    expect(await record(result, input({ amount: 6000 }))).toEqual({
      outcome: "earlier-attempt-saved",
      payment: savedRow(),
    });

    fetchMock.mockResolvedValueOnce(respond(201, savedRow({ id: "pay-2", amount: 6000 })));
    await record(result, input({ amount: 6000 }));
    const [, replayed, fresh] = sentKeys();
    expect(fresh).not.toBe(replayed);
  });
});
