import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  creditAccountKeys,
  useAddCardPurchases,
  useCreateCreditAccount,
  useCreateCreditPayment,
  useDeleteCreditAccount,
  useDeleteCreditPayment,
  useUpdateCreditAccount,
  useUpdateCreditPayment,
} from "@/hooks/use-credit-accounts";
import { debtAnalyticsKeys } from "@/hooks/use-debt-analytics";
import { cashFlowForecastKeys } from "@/hooks/use-cash-flow-forecast";

/** One cached read per screen a card write can leave stale. */
const READS = {
  card: creditAccountKeys.detail("card-1", "2026-09"),
  debt: debtAnalyticsKeys.range("2026-09-01", "2026-09-30"),
  forecast: cashFlowForecastKeys.forecast(90, -480),
  dashboard: ["dashboard", "stats"],
  analytics: ["analytics", { period: "monthly" }, -480],
} satisfies Record<string, QueryKey>;

type Read = keyof typeof READS;

const seededClient = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  for (const key of Object.values(READS)) client.setQueryData(key, { seeded: true });
  return client;
};

const invalidated = (client: QueryClient): Read[] =>
  (Object.keys(READS) as Read[]).filter((read) => client.getQueryState(READS[read])?.isInvalidated);

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => respond(200, { id: "x", transactions: [] })));
});

/** Runs one mutation to success and reports which cached reads it marked stale. */
const invalidatedBy = async <T,>(useMutationHook: () => { mutateAsync: (vars: T) => Promise<unknown> }, vars: T) => {
  const client = seededClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(useMutationHook, { wrapper });
  await act(async () => {
    await result.current.mutateAsync(vars);
  });
  return invalidated(client);
};

const payment = { kind: "PAYMENT" as const, amount: 5000, description: "", date: "2026-09-14" };

describe("card writes refresh every screen that shows what a card owes", () => {
  // A payment or a card's own terms are not spending, so the reports stay cached. Everything that
  // shows a balance, a due payment or the debt total has to go.
  it.each([
    ["recording a payment", () => invalidatedBy(useCreateCreditPayment, { accountId: "card-1", input: payment })],
    [
      "correcting a payment",
      () => invalidatedBy(useUpdateCreditPayment, { accountId: "card-1", paymentId: "p-1", patch: payment }),
    ],
    ["deleting a payment", () => invalidatedBy(useDeleteCreditPayment, { accountId: "card-1", paymentId: "p-1" })],
    [
      "editing a card's terms",
      () => invalidatedBy(useUpdateCreditAccount, { accountId: "card-1", patch: { plannedPayment: 8000 } }),
    ],
    ["adding a card", () => invalidatedBy(useCreateCreditAccount, { name: "BPI", color: "#E05B8D", openingBalance: 0 })],
    ["deleting a card", () => invalidatedBy(useDeleteCreditAccount, "card-1")],
  ])("%s refreshes the card, the Debt tab, the forecast and the dashboard", async (_name, run) => {
    expect(await run()).toEqual(["card", "debt", "forecast", "dashboard"]);
  });

  it("adding purchases refreshes those and the spending reports too", async () => {
    const stale = await invalidatedBy(useAddCardPurchases, { transactions: [], clientBatchId: "batch-1" });
    expect(stale).toEqual(["card", "debt", "forecast", "dashboard", "analytics"]);
  });

  // The contract `use-transactions.ts` relies on: an edit or delete there invalidates only the card
  // root, and the Debt tab has to be refreshed by it without being named at each of those sites.
  it("refreshing the card reads refreshes the Debt tab with them", async () => {
    const client = seededClient();
    await client.invalidateQueries({ queryKey: creditAccountKeys.all });
    expect(invalidated(client)).toEqual(["card", "debt"]);
  });
});
