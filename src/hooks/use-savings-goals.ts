import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { analyticsKeys } from "@/hooks/use-analytics";
import type { SavingsGoalSummary } from "@/types";
import type {
  SavingsGoalContributionInput,
  SavingsGoalInput,
  SavingsGoalPatchInput,
} from "@/lib/validations";

export const savingsGoalKeys = {
  all: ["savings-goals"] as const,
  list: (includeArchived: boolean) => ["savings-goals", { includeArchived }] as const,
};

const readError = async (response: Response, fallback: string): Promise<never> => {
  const body = await response.json().catch(() => null);
  throw new Error(body?.error ?? fallback);
};

export function useSavingsGoals(includeArchived = false) {
  return useQuery({
    queryKey: savingsGoalKeys.list(includeArchived),
    queryFn: async (): Promise<SavingsGoalSummary[]> => {
      const params = includeArchived ? "?includeArchived=true" : "";
      const response = await fetch(`/api/goals${params}`);
      if (!response.ok) await readError(response, "Failed to load savings goals");
      return response.json();
    },
  });
}

/**
 * Every goal mutation invalidates the analytics cache as well as the goal list.
 *
 * The Watchlist's goal findings are computed inside `/api/assessment/facts`, so funding a goal
 * without this leaves "behind the pace it needs" on screen next to the contribution that fixed it.
 */
const useGoalMutation = <TInput,>(
  mutationFn: (input: TInput) => Promise<unknown>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: savingsGoalKeys.all }),
        queryClient.invalidateQueries({ queryKey: analyticsKeys.all }),
      ]);
    },
  });
};

export function useCreateSavingsGoal() {
  return useGoalMutation(async (input: SavingsGoalInput) => {
    const response = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) await readError(response, "Failed to create savings goal");
    return response.json();
  });
}

export function useUpdateSavingsGoal() {
  return useGoalMutation(async ({ id, patch }: { id: string; patch: SavingsGoalPatchInput }) => {
    const response = await fetch(`/api/goals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) await readError(response, "Failed to update savings goal");
    return response.json();
  });
}

export function useDeleteSavingsGoal() {
  return useGoalMutation(async (id: string) => {
    const response = await fetch(`/api/goals/${id}`, { method: "DELETE" });
    if (!response.ok) await readError(response, "Failed to delete savings goal");
    return response.json();
  });
}

export function useAddGoalContribution() {
  return useGoalMutation(async ({ id, input }: { id: string; input: SavingsGoalContributionInput }) => {
    const response = await fetch(`/api/goals/${id}/contributions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) await readError(response, "Failed to save contribution");
    return response.json();
  });
}
