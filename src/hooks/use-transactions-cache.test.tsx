import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys, useBatchCreateTransactions } from "@/hooks/use-transactions";
import type { TransactionFilters } from "@/components/transactions/transaction-filters";

/**
 * A batch saved through the app is APP-created, and the infinite-cache splice orders by date
 * alone without consulting the query's filters. Splicing into a cache filtered to MCP would
 * therefore render an app-created row under "Added by Claude", which is precisely the claim
 * `created_via` exists to make trustworthy.
 */

const baseFilters: TransactionFilters = {
  search: "",
  type: "ALL",
  month: "2026-08",
  categoryId: null,
  labelId: null,
  createdVia: "ALL",
  amountMin: null,
  amountMax: null,
  sortBy: "date",
  sortDir: "desc",
};

const APP_ROW = {
  id: "tx_app",
  amount: 10,
  description: "Scanned receipt",
  type: "EXPENSE",
  date: "2026-08-25T00:00:00.000Z",
  categoryId: "c1",
  category: { id: "c1", name: "Food", icon: "x", color: "#000", type: "EXPENSE" },
  labels: [],
};

/** One page holding one older row, so an insert has somewhere to land. */
const seedPage = () => ({
  pages: [
    {
      transactions: [{ ...APP_ROW, id: "tx_existing", date: "2026-08-01T00:00:00.000Z" }],
      pagination: { page: 1, limit: 15, total: 1, totalPages: 1 },
    },
  ],
  pageParams: [1],
});

const idsIn = (data: unknown) =>
  (data as { pages: { transactions: { id: string }[] }[] } | undefined)?.pages.flatMap((p) =>
    p.transactions.map((t) => t.id)
  ) ?? [];

afterEach(() => vi.unstubAllGlobals());

describe("useBatchCreateTransactions cache insertion", () => {
  it("splices into unfiltered caches but not into an MCP-filtered one", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const anyFilters = { ...baseFilters, createdVia: "ALL" as const };
    const mcpFilters = { ...baseFilters, createdVia: "MCP" as const };
    const appFilters = { ...baseFilters, createdVia: "APP" as const };

    client.setQueryData(queryKeys.transactions.infinite(anyFilters, -480), seedPage());
    client.setQueryData(queryKeys.transactions.infinite(mcpFilters, -480), seedPage());
    client.setQueryData(queryKeys.transactions.infinite(appFilters, -480), seedPage());

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ transactions: [APP_ROW] }),
        } as Response)
      )
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useBatchCreateTransactions(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        transactions: [{ amount: 10, description: "Scanned receipt", type: "EXPENSE", date: "2026-08-25", categoryId: "c1" }],
      });
    });

    await waitFor(() =>
      expect(idsIn(client.getQueryData(queryKeys.transactions.infinite(anyFilters, -480)))).toContain(
        "tx_app"
      )
    );

    // The row belongs in "any" and in "app", and must never appear under "Claude".
    expect(idsIn(client.getQueryData(queryKeys.transactions.infinite(appFilters, -480)))).toContain(
      "tx_app"
    );
    expect(idsIn(client.getQueryData(queryKeys.transactions.infinite(mcpFilters, -480)))).not.toContain(
      "tx_app"
    );

    // The MCP cache is left intact rather than emptied.
    expect(idsIn(client.getQueryData(queryKeys.transactions.infinite(mcpFilters, -480)))).toEqual([
      "tx_existing",
    ]);
  });
});
