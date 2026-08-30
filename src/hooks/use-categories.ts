import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { CategoryInput } from "@/lib/validations";
import type { Category } from "@/types";
import { usePreferencesQuery, preferencesKeys } from "@/hooks/use-preferences";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface QuickPreferences {
  quickExpenseCategories: string[];
  quickIncomeCategories: string[];
}

/* ------------------------------------------------------------------ */
/*  Query key factory                                                  */
/* ------------------------------------------------------------------ */

/** Includes TRANSFER so the transaction form can resolve the one system category a transfer uses.
 *  `GET /api/categories` hides that category unless it is asked for by name, so no other caller
 *  sees it. */
export type CategoryQueryType = "INCOME" | "EXPENSE" | "TRANSFER";

export const categoryKeys = {
  all: ["categories"] as const,
  byType: (type?: CategoryQueryType) => ["categories", type] as const,
};

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

const fetchCategories = async (type?: CategoryQueryType): Promise<Category[]> => {
  const params = type ? `?type=${type}` : "";
  const res = await fetch(`/api/categories${params}`);
  if (!res.ok) throw new Error("Failed to fetch categories");
  return res.json();
};

/* ------------------------------------------------------------------ */
/*  Query hooks                                                        */
/* ------------------------------------------------------------------ */

/** Cached categories query — pass type to filter, omit for all */
export function useCategoriesQuery(type?: CategoryQueryType) {
  return useQuery({
    queryKey: categoryKeys.byType(type),
    queryFn: () => fetchCategories(type),
  });
}

/** Quick-access category preferences, derived from the shared preferences query. */
export function useQuickPreferencesQuery() {
  return usePreferencesQuery<QuickPreferences>((p) => ({
    quickExpenseCategories: p.quickExpenseCategories ?? [],
    quickIncomeCategories: p.quickIncomeCategories ?? [],
  }));
}

/* ------------------------------------------------------------------ */
/*  Mutation hooks                                                     */
/* ------------------------------------------------------------------ */

export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CategoryInput) => {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to create category");
      }
      return res.json() as Promise<Category>;
    },
    onSuccess: (_data, variables) => {
      // Invalidate the specific type and "all" queries
      queryClient.invalidateQueries({ queryKey: categoryKeys.byType(variables.type) });
      queryClient.invalidateQueries({ queryKey: categoryKeys.byType(undefined) });
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: CategoryInput }) => {
      const res = await fetch(`/api/categories/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to update category");
      }
      return res.json() as Promise<Category>;
    },
    onSuccess: () => {
      // Type could have changed, invalidate all category queries
      queryClient.invalidateQueries({ queryKey: categoryKeys.all });
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to delete category");
      }
      return id;
    },
    onSuccess: () => {
      // Invalidate all category queries
      queryClient.invalidateQueries({ queryKey: categoryKeys.all });
    },
  });
}

export function useSaveQuickPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { type: "EXPENSE" | "INCOME"; ids: string[] }) => {
      const field = payload.type === "EXPENSE"
        ? "quickExpenseCategories"
        : "quickIncomeCategories";
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: payload.ids }),
      });
      if (!res.ok) throw new Error("Failed to save quick preferences");
      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: preferencesKeys.all });
    },
  });
}
