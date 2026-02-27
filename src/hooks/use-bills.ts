import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "@/hooks/use-transactions";
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
  pending: ["bills", "pending"] as const,
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

const fetchPendingReminders = async (): Promise<PendingReminder[]> => {
  const res = await fetch("/api/bills/pending");
  if (!res.ok) throw new Error("Failed to fetch pending reminders");
  return res.json();
};

interface HistoryResponse {
  logs: ScheduledTransactionLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const fetchBillHistory = async (id: string): Promise<HistoryResponse> => {
  const res = await fetch(`/api/bills/${id}/history`);
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

export function usePendingRemindersQuery() {
  return useQuery({
    queryKey: billKeys.pending,
    queryFn: fetchPendingReminders,
    refetchOnWindowFocus: true,
  });
}

export function useBillHistoryQuery(id: string) {
  return useQuery({
    queryKey: billKeys.history(id),
    queryFn: () => fetchBillHistory(id),
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

export function useBillAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: BillActionInput }) => {
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
      queryClient.invalidateQueries({ queryKey: billKeys.all });
      queryClient.invalidateQueries({ queryKey: billKeys.pending });

      // If paid, also invalidate transactions and dashboard
      if (variables.input.action === "pay") {
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      }
    },
  });
}
