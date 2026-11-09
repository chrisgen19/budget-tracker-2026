import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayAndEditData } from "@/components/bills/bill-reminder-banner";
import { useBillPayAndEdit } from "@/hooks/use-bill-pay-and-edit";
import type { TransactionInput } from "@/lib/validations";

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showToast }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

const BILL_EDIT: PayAndEditData = {
  amount: 1200,
  description: "DMCI Water",
  type: "EXPENSE",
  date: "2026-11-09T20:15",
  categoryId: "utilities",
  billId: "bill-1",
  billDueDate: "2026-09-08T00:00:00.000Z",
};

const INPUT: TransactionInput = {
  amount: 1350,
  description: "DMCI Water",
  type: "EXPENSE",
  date: "2026-11-09T20:15",
  categoryId: "utilities",
};

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let fetchMock: ReturnType<typeof vi.fn>;

const callsTo = (fragment: string) =>
  fetchMock.mock.calls.filter((call) => String(call[0]).includes(fragment));

const setup = async () => {
  const { result } = renderHook(() => useBillPayAndEdit(), { wrapper: createWrapper() });
  act(() => result.current.openBillEdit(BILL_EDIT));
  await act(async () => {
    await result.current.submitBillEdit(INPUT);
  });
  return result;
};

beforeEach(() => {
  showToast.mockReset();
  fetchMock = vi.fn(async (url: string) =>
    url.includes("/action")
      ? respond(200, { message: "Bill marked as paid" })
      : respond(201, { id: "tx-new" }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useBillPayAndEdit", () => {
  // The settlement tests supply the flag themselves, so only this one notices the caller dropping it.
  it("settles the occurrence with the transaction it just created", async () => {
    const result = await setup();

    const [call] = callsTo("/api/bills/bill-1/action");
    expect(JSON.parse((call[1] as { body: string }).body)).toEqual({
      action: "pay_existing",
      dueDate: "2026-09-08T00:00:00.000Z",
      transactionId: "tx-new",
      createdForOccurrence: true,
    });
    expect(showToast).toHaveBeenCalledWith("DMCI Water paid");
    expect(result.current.billEditData).toBeNull();
  });

  it("says the transaction was saved when settling fails", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/action")
        ? respond(400, { error: "That payment is too far from the due date" })
        : respond(201, { id: "tx-new" }),
    );

    await setup();

    expect(showToast).toHaveBeenCalledWith(
      "Transaction saved but bill could not be marked as paid. Please pay the bill manually.",
    );
  });

  it("does not try to settle when the transaction was not created", async () => {
    fetchMock.mockImplementation(async () => respond(400, { error: "Invalid input" }));
    const { result } = renderHook(() => useBillPayAndEdit(), { wrapper: createWrapper() });
    act(() => result.current.openBillEdit(BILL_EDIT));

    await act(async () => {
      await expect(result.current.submitBillEdit(INPUT)).rejects.toThrow();
    });

    expect(callsTo("/action")).toHaveLength(0);
    expect(result.current.billEditData).toEqual(BILL_EDIT);
  });
});
