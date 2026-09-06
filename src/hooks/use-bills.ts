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
  candidates: (id: string, dueDate: string) =>
    ["bills", "candidates", id, dueDate] as const,
  /** Prefix for every candidate list, invalidated whenever transactions change. */
  candidatesAll: ["bills", "candidates"] as const,
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
  /** Expected cost. Derived from history when `isEstimate`; never state it flatly then. */
  amount: number;
  isEstimate: boolean;
  estimateBasis: "same-month-last-year" | "last-payment" | "budgeted" | null;
  dueDate: string;
  isOverdue: boolean;
  daysUntilDue: number;
}

export interface UpcomingBillsResponse {
  count: number;
  totalAmount: number;
  /** True when any bill's amount was derived, so the total is an approximation. */
  totalIsEstimate: boolean;
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

export type BillPaymentCandidate = {
  id: string;
  /** The instant, kept for ordering. */
  date: string;
  /** The payment's day in the account's own calendar. Render this, never `date`. */
  localDate: string;
  amount: number;
  description: string;
  category: { name: string; icon: string; color: string };
};

/**
 * Payments that could settle a skipped occurrence, for correcting it in place.
 * Enabled only when a due date is supplied, so opening the panel is what
 * fetches -- a bill's history can list many skips and none of them are usually
 * being corrected.
 */
export function useBillPaymentCandidatesQuery(id: string, dueDate: string | null) {
  return useQuery({
    queryKey: billKeys.candidates(id, dueDate ?? ""),
    queryFn: async (): Promise<{
      candidates: BillPaymentCandidate[];
      windowDays: number;
      categoryName: string;
      expectedAmount: number;
      expectedIsEstimate: boolean;
    }> => {
      const res = await fetch(
        `/api/bills/${id}/candidates?dueDate=${encodeURIComponent(dueDate!)}`,
      );
      if (!res.ok) throw new Error("Failed to load payments");
      return res.json();
    },
    enabled: !!id && !!dueDate,
    // Always refetch on open. The list is derived from the transaction ledger,
    // and the client default holds a query fresh for five minutes without
    // refetching on focus -- so a payment added or re-dated while the panel was
    // shut stayed invisible, and the panel offered a stale set of candidates.
    staleTime: 0,
    refetchOnMount: "always",
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
