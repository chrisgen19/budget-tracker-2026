import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type { TransactionInput } from "@/lib/validations";
import type { TransactionWithCategory, DashboardStats } from "@/types";
import type { TransactionFilters } from "@/components/transactions/transaction-filters";
import { labelKeys } from "@/hooks/use-labels";
import { analyticsKeys } from "@/hooks/use-analytics";
import type { TransactionSelectionItem } from "@/lib/transaction-bulk";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TransactionsResponse {
  transactions: TransactionWithCategory[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Query key factory                                                  */
/* ------------------------------------------------------------------ */

export const queryKeys = {
  transactions: {
    all: ["transactions"] as const,
    lists: ["transactions", "list"] as const,
    list: (filters: TransactionFilters, page: number, timezoneOffset: number) =>
      ["transactions", "list", filters, page, timezoneOffset] as const,
    infinite: (filters: TransactionFilters, timezoneOffset: number) =>
      ["transactions", "infinite", filters, timezoneOffset] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    byMonth: (month: string, timezoneOffset: number) =>
      ["dashboard", month, timezoneOffset] as const,
  },
};

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

export const buildTransactionParams = (filters: TransactionFilters, page: number, tz: number) => {
  const params = new URLSearchParams({
    page: String(page),
    limit: "15",
    month: filters.month,
    tz: String(tz),
  });
  if (filters.type !== "ALL") params.set("type", filters.type);
  if (filters.search) params.set("search", filters.search);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.labelId) params.set("labelId", filters.labelId);
  if (filters.createdVia !== "ALL") params.set("createdVia", filters.createdVia);
  if (filters.amountMin !== null) params.set("amountMin", String(filters.amountMin));
  if (filters.amountMax !== null) params.set("amountMax", String(filters.amountMax));
  if (filters.sortBy !== "date") params.set("sortBy", filters.sortBy);
  if (filters.sortDir !== "desc") params.set("sortDir", filters.sortDir);
  return params;
};

const responseError = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(body?.error || fallback);
};

export const fetchTransactionById = async (id: string): Promise<TransactionWithCategory> => {
  const response = await fetch(`/api/transactions/${id}`);
  if (!response.ok) throw await responseError(response, "Failed to load transaction");
  return response.json();
};

export const fetchTransactionsPage = async (
  filters: TransactionFilters,
  page: number,
  tz: number
): Promise<TransactionsResponse> => {
  const params = buildTransactionParams(filters, page, tz);
  const res = await fetch(`/api/transactions?${params}`);
  if (!res.ok) throw new Error("Failed to fetch transactions");
  return res.json();
};

const fetchDashboard = async (month: string, tz: number): Promise<DashboardStats> => {
  const res = await fetch(`/api/dashboard?month=${month}&tz=${tz}`);
  if (!res.ok) throw new Error("Failed to fetch dashboard");
  return res.json();
};

/* ------------------------------------------------------------------ */
/*  Query hooks                                                        */
/* ------------------------------------------------------------------ */

/** Paginated transactions (non-infinite mode) */
export function useTransactionsQuery(filters: TransactionFilters, page: number, tz: number) {
  return useQuery({
    queryKey: queryKeys.transactions.list(filters, page, tz),
    queryFn: () => fetchTransactionsPage(filters, page, tz),
    placeholderData: (previousData) => previousData,
  });
}

/** Infinite scroll transactions */
export function useTransactionsInfiniteQuery(filters: TransactionFilters, tz: number) {
  return useInfiniteQuery({
    queryKey: queryKeys.transactions.infinite(filters, tz),
    queryFn: ({ pageParam }) => fetchTransactionsPage(filters, pageParam, tz),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.totalPages
        ? lastPage.pagination.page + 1
        : undefined,
  });
}

/** Dashboard stats */
export function useDashboardQuery(month: string, tz: number) {
  return useQuery({
    queryKey: queryKeys.dashboard.byMonth(month, tz),
    queryFn: () => fetchDashboard(month, tz),
  });
}

/* ------------------------------------------------------------------ */
/*  Cache update helpers                                               */
/* ------------------------------------------------------------------ */

type InfiniteTransactionsData = InfiniteData<TransactionsResponse, number>;

/**
 * Insert a new transaction into the correct date-sorted position in infinite data.
 * Both transaction cache keys carry their filters at index 2:
 * `["transactions", "list", filters, page, timezoneOffset]` and
 * `["transactions", "infinite", filters, timezoneOffset]`.
 */
const filtersOfKey = (key: readonly unknown[]): TransactionFilters | undefined =>
  key[0] === "transactions" && typeof key[2] === "object" && key[2] !== null
    ? (key[2] as TransactionFilters)
    : undefined;

const insertTransactionIntoInfiniteData = (
  data: InfiniteTransactionsData,
  tx: TransactionWithCategory
): InfiniteTransactionsData => {
  const txDate = new Date(tx.date).getTime();

  // Find which page to insert into (pages are sorted by date desc)
  const newPages = data.pages.map((page) => ({ ...page, transactions: [...page.transactions] }));

  let inserted = false;
  for (const page of newPages) {
    for (let i = 0; i < page.transactions.length; i++) {
      const existingDate = new Date(page.transactions[i].date).getTime();
      if (txDate >= existingDate) {
        page.transactions.splice(i, 0, tx);
        inserted = true;
        break;
      }
    }
    if (inserted) break;
  }

  // If not inserted (older than all existing), add to last page
  if (!inserted && newPages.length > 0) {
    newPages[newPages.length - 1].transactions.push(tx);
  }

  // Update total counts
  return {
    ...data,
    pages: newPages.map((page) => ({
      ...page,
      pagination: {
        ...page.pagination,
        total: page.pagination.total + 1,
      },
    })),
  };
};

/** Replace a transaction by ID in infinite data */
const replaceTransactionInInfiniteData = (
  data: InfiniteTransactionsData,
  tx: TransactionWithCategory
): InfiniteTransactionsData => ({
  ...data,
  pages: data.pages.map((page) => ({
    ...page,
    transactions: page.transactions.map((t) => (t.id === tx.id ? tx : t)),
  })),
});

/** Remove a transaction by ID from infinite data */
const removeTransactionFromInfiniteData = (
  data: InfiniteTransactionsData,
  id: string
): InfiniteTransactionsData => removeMultipleFromInfiniteData(data, new Set([id]));

/** Remove multiple transactions by IDs from infinite data */
const removeMultipleFromInfiniteData = (
  data: InfiniteTransactionsData,
  ids: Set<string>
): InfiniteTransactionsData => {
  const removedIds = new Set(
    data.pages.flatMap((page) => page.transactions.filter((tx) => ids.has(tx.id)).map((tx) => tx.id)),
  );
  return {
    ...data,
    pages: data.pages.map((page) => {
      const total = Math.max(0, page.pagination.total - removedIds.size);
      return {
        ...page,
        transactions: page.transactions.filter((transaction) => !ids.has(transaction.id)),
        pagination: {
          ...page.pagination,
          total,
          totalPages: Math.ceil(total / page.pagination.limit),
        },
      };
    }),
  };
};

const removeMultipleFromPaginatedData = (
  data: TransactionsResponse,
  ids: Set<string>,
): TransactionsResponse => {
  const removed = data.transactions.filter((transaction) => ids.has(transaction.id)).length;
  const total = Math.max(0, data.pagination.total - removed);
  return {
    ...data,
    transactions: data.transactions.filter((transaction) => !ids.has(transaction.id)),
    pagination: {
      ...data.pagination,
      total,
      totalPages: Math.ceil(total / data.pagination.limit),
    },
  };
};

/* ------------------------------------------------------------------ */
/*  Mutation hooks                                                     */
/* ------------------------------------------------------------------ */

export function useCreateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: TransactionInput) => {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to create transaction");
      return res.json() as Promise<TransactionWithCategory>;
    },
    onSuccess: (newTx) => {
      // Directly update infinite query caches
      queryClient.setQueriesData<InfiniteTransactionsData>(
        { queryKey: queryKeys.transactions.all },
        (old) => {
          if (!old?.pages) return old;
          return insertTransactionIntoInfiniteData(old, newTx);
        }
      );

      // Refetch active transaction queries (paginated + infinite) for full consistency
      queryClient.invalidateQueries({
        queryKey: queryKeys.transactions.all,
      });

      // Invalidate dashboard + analytics (triggers background refetch)
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.all,
      });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });

      // Invalidate label counts
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
      // Bill payment candidates are derived from transactions, so a write here
      // can add or remove one. Keyed literally rather than through billKeys:
      // use-bills.ts already imports from this module, and importing back would
      // make the cycle.
      queryClient.invalidateQueries({ queryKey: ["bills", "candidates"] });
    },
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: TransactionInput }) => {
      const res = await fetch(`/api/transactions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to update transaction");
      return res.json() as Promise<TransactionWithCategory>;
    },
    onSuccess: (updatedTx) => {
      // Remove old version and re-insert at the correct date-sorted position.
      // A plain in-place swap doesn't re-sort, so date/time changes would leave
      // the transaction in its old position until a full refetch.
      queryClient.setQueriesData<InfiniteTransactionsData>(
        { queryKey: queryKeys.transactions.all },
        (old) => {
          if (!old?.pages) return old;
          const removed = removeTransactionFromInfiniteData(old, updatedTx.id);
          return insertTransactionIntoInfiniteData(removed, updatedTx);
        }
      );

      // Refetch active transaction queries in the background for full consistency
      queryClient.invalidateQueries({
        queryKey: queryKeys.transactions.all,
      });

      // Invalidate dashboard + analytics
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.all,
      });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });

      // Invalidate label counts
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
      // Bill payment candidates are derived from transactions, so a write here
      // can add or remove one. Keyed literally rather than through billKeys:
      // use-bills.ts already imports from this module, and importing back would
      // make the cycle.
      queryClient.invalidateQueries({ queryKey: ["bills", "candidates"] });
    },
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (!res.ok) throw await responseError(res, "Failed to delete transaction");
      return id;
    },
    onSuccess: async (deletedId) => {
      const deletedIds = new Set([deletedId]);
      // Directly remove from infinite query caches
      queryClient.setQueriesData<InfiniteTransactionsData>(
        { queryKey: queryKeys.transactions.all },
        (old) => {
          if (!old?.pages) return old;
          return removeTransactionFromInfiniteData(old, deletedId);
        }
      );

      queryClient.setQueriesData<TransactionsResponse>(
        { queryKey: queryKeys.transactions.lists },
        (old) => old ? removeMultipleFromPaginatedData(old, deletedIds) : old,
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
        queryClient.invalidateQueries({ queryKey: analyticsKeys.all }),
        queryClient.invalidateQueries({ queryKey: labelKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["bills", "candidates"] }),
      ]);
    },
  });
}

export interface BulkDeleteResult {
  deleted: number;
  ids: string[];
}

export function useBulkDeleteTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch("/api/transactions/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw await responseError(res, "Failed to delete transactions");
      return res.json() as Promise<BulkDeleteResult>;
    },
    onSuccess: async (result) => {
      const idSet = new Set(result.ids);

      // Directly remove from infinite query caches
      queryClient.setQueriesData<InfiniteTransactionsData>(
        { queryKey: queryKeys.transactions.all },
        (old) => {
          if (!old?.pages) return old;
          return removeMultipleFromInfiniteData(old, idSet);
        }
      );

      queryClient.setQueriesData<TransactionsResponse>(
        { queryKey: queryKeys.transactions.lists },
        (old) => old ? removeMultipleFromPaginatedData(old, idSet) : old,
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
        queryClient.invalidateQueries({ queryKey: analyticsKeys.all }),
        queryClient.invalidateQueries({ queryKey: labelKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["bills", "candidates"] }),
      ]);
    },
  });
}

export function useTransactionSelectionSnapshot() {
  return useMutation({
    mutationFn: async ({
      filters,
      timezoneOffset,
    }: {
      filters: TransactionFilters;
      timezoneOffset: number;
    }) => {
      const response = await fetch("/api/transactions/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters, timezoneOffset }),
      });
      if (!response.ok) throw await responseError(response, "Failed to select transactions");
      return response.json() as Promise<{
        transactions: TransactionSelectionItem[];
        count: number;
      }>;
    },
  });
}

export function useExportTransactions() {
  return useMutation({
    mutationFn: async ({ ids, timezoneOffset }: { ids: string[]; timezoneOffset: number }) => {
      const response = await fetch("/api/transactions/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, timezoneOffset }),
      });
      if (!response.ok) throw await responseError(response, "Failed to export transactions");
      return {
        blob: await response.blob(),
        count: Number(response.headers.get("X-Exported-Count") ?? ids.length),
      };
    },
  });
}

export type BulkUpdateInput =
  | { ids: string[]; action: "category"; categoryId: string }
  | { ids: string[]; action: "labels"; operation: "add" | "remove"; labelIds: string[] };

export interface BulkUpdateResult {
  matched: number;
  updated: number;
  changedLinks?: number;
  ids: string[];
}

export function useBulkUpdateTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkUpdateInput) => {
      const response = await fetch("/api/transactions/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw await responseError(response, "Failed to update transactions");
      return response.json() as Promise<BulkUpdateResult>;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
        queryClient.invalidateQueries({ queryKey: analyticsKeys.all }),
        queryClient.invalidateQueries({ queryKey: labelKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["bills", "candidates"] }),
      ]);
    },
  });
}

/**
 * Whether a failed batch save could have written anything.
 *
 * `"no"` means the server definitively rejected it before any write, so the queue is free
 * to be corrected and resubmitted as a new intent. `"unknown"` means the batch may have
 * committed with its response lost, so the retry has to replay the same idempotency key
 * with the same rows rather than whatever the queue holds now.
 */
export class BatchSaveError extends Error {
  constructor(readonly committed: "no" | "unknown") {
    super(`Batch save failed (committed: ${committed})`);
    this.name = "BatchSaveError";
  }
}

export function useBatchCreateTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      transactions,
      clientBatchId,
    }: {
      transactions: Array<{
        amount: number;
        description: string;
        type: string;
        date: string;
        categoryId: string;
        receiptGroupId?: string;
        receiptBreakdown?: unknown;
      }>;
      /** Idempotency key so retrying an ambiguous failure cannot double-post. */
      clientBatchId?: string;
    }) => {
      let res: Response;
      try {
        res = await fetch("/api/transactions/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactions, clientBatchId }),
        });
      } catch {
        // No response at all: the request may or may not have reached the server.
        throw new BatchSaveError("unknown");
      }

      if (!res.ok) {
        // Every 4xx the route returns is raised before it opens a transaction (schema
        // rejection, label ownership), so nothing was written. A 5xx may come from our
        // own handler after a rollback, but it may equally be a proxy that lost the
        // response of a batch that committed — which is not safe to assume away.
        throw new BatchSaveError(res.status >= 400 && res.status < 500 ? "no" : "unknown");
      }

      try {
        return (await res.json()) as { transactions: TransactionWithCategory[] };
      } catch {
        // 2xx with an unreadable body: the write landed but we cannot read what it made.
        throw new BatchSaveError("unknown");
      }
    },
    onSuccess: (data) => {
      // Directly insert all new transactions into infinite query caches
      queryClient.setQueriesData<InfiniteTransactionsData>(
        {
          queryKey: queryKeys.transactions.all,
          // Everything saved through this hook is app-created, so it must never be spliced into
          // a cache filtered to a remote source: the row would appear under "Added by Claude" or
          // "Added via Telegram", which is exactly the claim `created_via` exists to make
          // trustworthy. The splice ignores the other filters too (it orders by date alone), but
          // those only ever show an extra row early; this one would misattribute it.
          predicate: (query) => {
            const via = filtersOfKey(query.queryKey)?.createdVia;
            return via !== "MCP" && via !== "TELEGRAM";
          },
        },
        (old) => {
          if (!old?.pages) return old;
          let updated = old;
          for (const tx of data.transactions) {
            updated = insertTransactionIntoInfiniteData(updated, tx);
          }
          return updated;
        }
      );

      // Invalidate paginated caches
      queryClient.invalidateQueries({
        queryKey: queryKeys.transactions.lists,
        refetchType: "none",
      });

      // Invalidate dashboard + analytics
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.all,
      });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
    },
  });
}

export function useRemoveTransactionLabel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ transactionId, labelId }: { transactionId: string; labelId: string }) => {
      const res = await fetch(`/api/transactions/${transactionId}/labels/${labelId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove label");
      return { transactionId, labelId };
    },
    onSuccess: ({ transactionId, labelId }) => {
      // Optimistically strip the label from infinite query caches
      queryClient.setQueriesData<InfiniteTransactionsData>(
        { queryKey: queryKeys.transactions.all },
        (old) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              transactions: page.transactions.map((t) =>
                t.id === transactionId
                  ? { ...t, labels: t.labels?.filter((tl) => tl.labelId !== labelId) }
                  : t
              ),
            })),
          };
        }
      );

      // Invalidate all transaction queries so filtered views (including infinite
      // queries with a labelId filter) refetch and exclude the transaction.
      // The optimistic cache update above gives instant UI feedback for the
      // common case; the invalidation ensures correctness for filtered views.
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      queryClient.invalidateQueries({ queryKey: labelKeys.all });
      // Bill payment candidates are derived from transactions, so a write here
      // can add or remove one. Keyed literally rather than through billKeys:
      // use-bills.ts already imports from this module, and importing back would
      // make the cycle.
      queryClient.invalidateQueries({ queryKey: ["bills", "candidates"] });
    },
    onError: () => {
      // Refetch to restore consistent state (pill stays visible since cache
      // update only happens onSuccess, but invalidate to be safe)
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
