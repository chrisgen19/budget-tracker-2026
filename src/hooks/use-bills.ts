import {
  useQuery,
  useInfiniteQuery,
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
  upcoming: ["bills", "upcoming"] as const,
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

export interface UpcomingBill {
  id: string;
  description: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  amount: number;
  dueDate: string;
  isOverdue: boolean;
}

export interface UpcomingBillsResponse {
  count: number;
  totalAmount: number;
  bills: UpcomingBill[];
}

const fetchUpcomingBills = async (): Promise<UpcomingBillsResponse> => {
  const res = await fetch("/api/bills/upcoming");
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

export function usePendingRemindersQuery() {
  return useQuery({
    queryKey: billKeys.pending,
    queryFn: fetchPendingReminders,
    refetchOnWindowFocus: true,
  });
}

export function useUpcomingBillsQuery() {
  return useQuery({
    queryKey: billKeys.upcoming,
    queryFn: fetchUpcomingBills,
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
      queryClient.invalidateQueries({ queryKey: billKeys.pending });
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
      if (variables.input.action === "pay" || variables.input.action === "pay_existing") {
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      }
    },
  });
}
