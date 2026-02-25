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
    list: (filters: TransactionFilters, page: number) =>
      ["transactions", "list", filters, page] as const,
    infinite: (filters: TransactionFilters) =>
      ["transactions", "infinite", filters] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    byMonth: (month: string) => ["dashboard", month] as const,
  },
};

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

const buildTransactionParams = (filters: TransactionFilters, page: number) => {
  const params = new URLSearchParams({
    page: String(page),
    limit: "15",
    month: filters.month,
  });
  if (filters.type !== "ALL") params.set("type", filters.type);
  if (filters.search) params.set("search", filters.search);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.amountMin !== null) params.set("amountMin", String(filters.amountMin));
  if (filters.amountMax !== null) params.set("amountMax", String(filters.amountMax));
  if (filters.sortBy !== "date") params.set("sortBy", filters.sortBy);
  if (filters.sortDir !== "desc") params.set("sortDir", filters.sortDir);
  return params;
};

const fetchTransactionsPage = async (
  filters: TransactionFilters,
  page: number
): Promise<TransactionsResponse> => {
  const params = buildTransactionParams(filters, page);
  const res = await fetch(`/api/transactions?${params}`);
  if (!res.ok) throw new Error("Failed to fetch transactions");
  return res.json();
};

const fetchDashboard = async (month: string): Promise<DashboardStats> => {
  const res = await fetch(`/api/dashboard?month=${month}`);
  if (!res.ok) throw new Error("Failed to fetch dashboard");
  return res.json();
};

/* ------------------------------------------------------------------ */
/*  Query hooks                                                        */
/* ------------------------------------------------------------------ */

/** Paginated transactions (non-infinite mode) */
export function useTransactionsQuery(filters: TransactionFilters, page: number) {
  return useQuery({
    queryKey: queryKeys.transactions.list(filters, page),
    queryFn: () => fetchTransactionsPage(filters, page),
    placeholderData: (previousData) => previousData,
  });
}

/** Infinite scroll transactions */
export function useTransactionsInfiniteQuery(filters: TransactionFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.transactions.infinite(filters),
    queryFn: ({ pageParam }) => fetchTransactionsPage(filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.totalPages
        ? lastPage.pagination.page + 1
        : undefined,
  });
}

/** Dashboard stats */
export function useDashboardQuery(month: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.byMonth(month),
    queryFn: () => fetchDashboard(month),
  });
}

/* ------------------------------------------------------------------ */
/*  Cache update helpers                                               */
/* ------------------------------------------------------------------ */

type InfiniteTransactionsData = InfiniteData<TransactionsResponse, number>;

/** Insert a new transaction into the correct date-sorted position in infinite data */
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
): InfiniteTransactionsData => ({
  ...data,
  pages: data.pages.map((page) => ({
    ...page,
    transactions: page.transactions.filter((t) => t.id !== id),
    pagination: {
      ...page.pagination,
      total: Math.max(0, page.pagination.total - 1),
    },
  })),
});

/** Remove multiple transactions by IDs from infinite data */
const removeMultipleFromInfiniteData = (
  data: InfiniteTransactionsData,
  ids: Set<string>
): InfiniteTransactionsData => ({
  ...data,
  pages: data.pages.map((page) => ({
    ...page,
    transactions: page.transactions.filter((t) => !ids.has(t.id)),
    pagination: {
      ...page.pagination,
      total: Math.max(0, page.pagination.total - ids.size),
    },
  })),
});

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

      // Invalidate paginated caches (triggers background refetch)
      queryClient.invalidateQueries({
        queryKey: queryKeys.transactions.all,
        refetchType: "none",
      });

      // Invalidate dashboard (triggers background refetch)
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.all,
      });
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
      // Directly update infinite query caches
      queryClient.setQueriesData<InfiniteTransactionsData>(
        { queryKey: queryKeys.transactions.all },
        (old) => {
          if (!old?.pages) return old;
          return replaceTransactionInInfiniteData(old, updatedTx);
        }
      );

      // Invalidate paginated caches
      queryClient.invalidateQueries({
        queryKey: queryKeys.transactions.all,
        refetchType: "none",
      });

      // Invalidate dashboard
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.all,
      });
    },
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete transaction");
      return id;
    },
    onSuccess: (deletedId) => {
      // Directly remove from infinite query caches
      queryClient.setQueriesData<InfiniteTransactionsData>(
        { queryKey: queryKeys.transactions.all },
        (old) => {
          if (!old?.pages) return old;
          return removeTransactionFromInfiniteData(old, deletedId);
        }
      );

      // Invalidate paginated caches
      queryClient.invalidateQueries({
        queryKey: queryKeys.transactions.all,
        refetchType: "none",
      });

      // Invalidate dashboard
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.all,
      });
    },
  });
}

export function useBulkDeleteTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) => fetch(`/api/transactions/${id}`, { method: "DELETE" }))
      );
      return ids;
    },
    onSuccess: (deletedIds) => {
      const idSet = new Set(deletedIds);

      // Directly remove from infinite query caches
      queryClient.setQueriesData<InfiniteTransactionsData>(
        { queryKey: queryKeys.transactions.all },
        (old) => {
          if (!old?.pages) return old;
          return removeMultipleFromInfiniteData(old, idSet);
        }
      );

      // Invalidate paginated caches
      queryClient.invalidateQueries({
        queryKey: queryKeys.transactions.all,
        refetchType: "none",
      });

      // Invalidate dashboard
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.all,
      });
    },
  });
}

export function useBatchCreateTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      transactions: Array<{
        amount: number;
        description: string;
        type: string;
        date: string;
        categoryId: string;
      }>
    ) => {
      const res = await fetch("/api/transactions/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions }),
      });
      if (!res.ok) throw new Error("Failed to create transactions");
      return res.json() as Promise<{ transactions: TransactionWithCategory[] }>;
    },
    onSuccess: (data) => {
      // Directly insert all new transactions into infinite query caches
      queryClient.setQueriesData<InfiniteTransactionsData>(
        { queryKey: queryKeys.transactions.all },
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
        queryKey: queryKeys.transactions.all,
        refetchType: "none",
      });

      // Invalidate dashboard
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.all,
      });
    },
  });
}
