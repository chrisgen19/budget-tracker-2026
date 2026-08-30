import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountBalance } from "@/lib/budget-query-types";
import type { AccountInput } from "@/lib/validations";

export const accountKeys = {
  all: ["accounts"] as const,
  list: (includeInactive: boolean) => ["accounts", { includeInactive }] as const,
};

const fetchAccounts = async (includeInactive: boolean): Promise<AccountBalance[]> => {
  const res = await fetch(`/api/accounts?includeInactive=${includeInactive}`);
  if (!res.ok) throw new Error("Failed to fetch accounts");
  return res.json();
};

/** Accounts with their derived balances. Archived ones are excluded unless asked for. */
export function useAccountsQuery(includeInactive = false) {
  return useQuery({
    queryKey: accountKeys.list(includeInactive),
    queryFn: () => fetchAccounts(includeInactive),
  });
}

const mutateAccount = async (
  input: AccountInput & { id?: string }
): Promise<AccountBalance> => {
  const { id, ...body } = input;
  const res = await fetch(id ? `/api/accounts/${id}` : "/api/accounts", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Failed to save account");
  }
  return res.json();
};

export function useSaveAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mutateAccount,
    // Balances are derived from transactions, so any account change can move a figure on any
    // other view that shows one. Invalidating the whole key is cheaper than reasoning about which.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.all }),
  });
}

export function useDeleteAccountMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to remove account");
      }
      return res.json() as Promise<{ archived: boolean; transactionCount: number }>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.all }),
  });
}
