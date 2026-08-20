import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "@/hooks/use-transactions";
import { analyticsKeys } from "@/hooks/use-analytics";
import type { ScheduledTransactionInput, BillActionInput } from "@/lib/validations";
import type { ScheduledTransactionWithCategory, PendingReminder } from "@/types";
import type { ScheduledTransactionLog } from "@prisma/client";

/* ------------------------------------------------------------------ */
/*  Query key factory                                                  */
/* ------------------------------------------------------------------ */

export const billKeys = {
  all: ["bills"] as const,
  list: (filters?: { active?: boolean; type?: string }) =>
    ["bills", "list", filters] as const,
  pending: (tz: number) => ["bills", "pending", tz] as const,
  pendingAll: ["bills", "pending"] as const,
  upcoming: (tz: number) => ["bills", "upcoming", tz] as const,
  history: (id: string) => ["bills", "history", id] as const,
};

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

const fetchBills = async (filters?: {
  active?: boolean;
  type?: string;
}): Promise<ScheduledTransactionWithCategory[]> => {
  const params = new URLSearchParams();
  if (filters?.active !== undefined) params.set("active", String(filters.active));
  if (filters?.type) params.set("type", filters.type);
  const qs = params.toString();
  const res = await fetch(`/api/bills${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch bills");
  return res.json();
};

const fetchPendingReminders = async (tz: number): Promise<PendingReminder[]> => {
  const res = await fetch(`/api/bills/pending?tz=${tz}`);
  if (!res.ok) throw new Error("Failed to fetch pending reminders");
  return res.json();
};

export interface UpcomingBill {
  id: string;
  description: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  amount: number;
  dueDate: string;
  isOverdue: boolean;
  daysUntilDue: number;
}

export interface UpcomingBillsResponse {
  count: number;
  totalAmount: number;
  bills: UpcomingBill[];
}

const fetchUpcomingBills = async (tz: number): Promise<UpcomingBillsResponse> => {
  const res = await fetch(`/api/bills/upcoming?tz=${tz}`);
  if (!res.ok) throw new Error("Failed to fetch upcoming bills");
  return res.json();
};

export interface HistoryLog extends ScheduledTransactionLog {
  paidAmount: number | null;
}

interface HistoryResponse {
  logs: HistoryLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const HISTORY_PAGE_SIZE = 10;

const fetchBillHistory = async (id: string, page: number): Promise<HistoryResponse> => {
  const res = await fetch(`/api/bills/${id}/history?page=${page}&limit=${HISTORY_PAGE_SIZE}`);
  if (!res.ok) throw new Error("Failed to fetch bill history");
  return res.json();
};

/* ------------------------------------------------------------------ */
/*  Query hooks                                                        */
/* ------------------------------------------------------------------ */

export function useBillsQuery(filters?: { active?: boolean; type?: string }) {
  return useQuery({
    queryKey: billKeys.list(filters),
    queryFn: () => fetchBills(filters),
  });
}

export function usePendingRemindersQuery(tz: number) {
  return useQuery({
    queryKey: billKeys.pending(tz),
    queryFn: () => fetchPendingReminders(tz),
    // refetchOnWindowFocus is already the default — staleTime prevents
    // rapid-fire refetches when the user alt-tabs frequently.
    staleTime: 60_000,
  });
}

export function useUpcomingBillsQuery(tz: number) {
  return useQuery({
    queryKey: billKeys.upcoming(tz),
    queryFn: () => fetchUpcomingBills(tz),
    staleTime: 60_000,
  });
}

export function useBillHistoryQuery(id: string) {
  return useInfiniteQuery({
    queryKey: billKeys.history(id),
    queryFn: ({ pageParam }) => fetchBillHistory(id, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.totalPages
        ? lastPage.pagination.page + 1
        : undefined,
    enabled: !!id,
  });
}

/* ------------------------------------------------------------------ */
/*  Mutation hooks                                                     */
/* ------------------------------------------------------------------ */

export function useCreateBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ScheduledTransactionInput) => {
      const res = await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to create bill");
      }
      return res.json() as Promise<ScheduledTransactionWithCategory>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billKeys.all });
    },
  });
}

export function useUpdateBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ScheduledTransactionInput }) => {
      const res = await fetch(`/api/bills/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to update bill");
      }
      return res.json() as Promise<ScheduledTransactionWithCategory>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billKeys.all });
    },
  });
}

export function useDeleteBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/bills/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to delete bill");
      }
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billKeys.all });
    },
  });
}

export function useReactivateBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/bills/${id}`, { method: "PATCH" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to reactivate bill");
      }
      return res.json() as Promise<ScheduledTransactionWithCategory>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billKeys.all });
      queryClient.invalidateQueries({ queryKey: billKeys.pendingAll });
    },
  });
}

/** Invalidate everything a bill payment touches. Exported so batch callers can
 *  run it once instead of per payment. */
export function useInvalidateBillPayment() {
  const queryClient = useQueryClient();
  // Returns a promise so callers can wait for the refetch to land before
  // re-enabling controls that act on the now-stale list.
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: billKeys.all }),
        queryClient.invalidateQueries({ queryKey: billKeys.pendingAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
        queryClient.invalidateQueries({ queryKey: analyticsKeys.all }),
      ]),
    [queryClient],
  );
}

export function useBillAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: BillActionInput; skipInvalidate?: boolean }) => {
      const res = await fetch(`/api/bills/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to process bill action");
      }
      return res.json() as Promise<{ message: string; transactionId?: string }>;
    },
    onSuccess: (_data, variables) => {
      // Pay All opts out and invalidates once at the end: otherwise a 23-bill
      // run fires ~100 refetches that queue up against the payments themselves.
      if (variables.skipInvalidate) return;

      queryClient.invalidateQueries({ queryKey: billKeys.all });
      queryClient.invalidateQueries({ queryKey: billKeys.pendingAll });

      // If paid, also invalidate transactions, dashboard, and analytics
      if (variables.input.action === "pay" || variables.input.action === "pay_existing") {
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
        queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      }
    },
  });
}
