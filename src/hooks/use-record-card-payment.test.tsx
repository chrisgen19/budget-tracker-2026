import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRecordCardPayment, type RecordPaymentResult } from "@/hooks/use-record-card-payment";
import type { CreditPaymentInput } from "@/lib/validations";

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
const sentBodies = () =>
  fetchMock.mock.calls.map(
    (call) => JSON.parse((call[1] as { body: string }).body) as CreditPaymentInput & { clientRequestId?: string }
  );

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

const setup = () => renderHook(() => useRecordCardPayment(), { wrapper: createWrapper() });
type Hook = { current: ReturnType<typeof useRecordCardPayment> };

const act$ = async (run: () => Promise<RecordPaymentResult | null>) => {
  let outcome: RecordPaymentResult | null = null;
  await act(async () => {
    outcome = await run();
  });
  return outcome as RecordPaymentResult | null;
};
const record = (result: Hook, value = input()) => act$(() => result.current.submit("card-1", value));

describe("useRecordCardPayment", () => {
  it("pins the payment after a lost response, and retries exactly it under the same key", async () => {
    const { result } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await record(result)).toEqual({ outcome: "unconfirmed" });
    expect(result.current.unconfirmed).toEqual(input());

    fetchMock.mockResolvedValueOnce(respond(200, savedRow()));
    expect(await act$(() => result.current.retry())).toEqual({ outcome: "saved", payment: savedRow() });
    expect(result.current.unconfirmed).toBeNull();

    const [first, second] = sentBodies();
    expect(first.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toEqual(first);
  });

  it("treats a server error as unconfirmed, since the payment may have committed behind it", async () => {
    const { result } = setup();
    fetchMock.mockResolvedValueOnce(respond(502, null));

    expect(await record(result)).toEqual({ outcome: "unconfirmed" });
    expect(result.current.unconfirmed).toEqual(input());
  });

  it("starts a new key once a payment is saved, so the next one is a new payment", async () => {
    const { result } = setup();
    fetchMock.mockResolvedValueOnce(respond(201, savedRow()));
    fetchMock.mockResolvedValueOnce(respond(201, savedRow({ id: "pay-2" })));

    await record(result);
    await record(result);

    const [first, second] = sentBodies();
    expect(second.clientRequestId).not.toBe(first.clientRequestId);
  });

  it("keeps the key after a refusal, and pins nothing, since nothing was stored under it", async () => {
    const { result } = setup();
    fetchMock.mockResolvedValueOnce(respond(409, { error: "That card is archived" }));
    expect(await record(result)).toEqual({ outcome: "refused", message: "That card is archived" });
    expect(result.current.unconfirmed).toBeNull();

    fetchMock.mockResolvedValueOnce(respond(201, savedRow({ amount: 4000 })));
    await record(result, input({ amount: 4000 }));

    const [first, second] = sentBodies();
    expect(second.clientRequestId).toBe(first.clientRequestId);
  });

  // The review finding on #397: a key left armed after an unconfirmed save answered the *next*
  // payment with the old one. Discarding is how that state is left, and it must drop the key.
  it("gives the next payment a new key once an unconfirmed one is discarded", async () => {
    const { result } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await record(result);

    act(() => result.current.discard());
    expect(result.current.unconfirmed).toBeNull();

    fetchMock.mockResolvedValueOnce(respond(201, savedRow({ id: "pay-2", amount: 6000 })));
    await record(result, input({ amount: 6000 }));

    const [abandoned, next] = sentBodies();
    expect(next.clientRequestId).not.toBe(abandoned.clientRequestId);
  });
});
