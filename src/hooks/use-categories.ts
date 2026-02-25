import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { CategoryInput } from "@/lib/validations";
import type { Category } from "@/types";

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

export const categoryKeys = {
  all: ["categories"] as const,
  byType: (type?: "INCOME" | "EXPENSE") => ["categories", type] as const,
  preferences: {
    quick: ["preferences", "quick"] as const,
  },
};

/* ------------------------------------------------------------------ */
/*  Fetch helpers                                                      */
/* ------------------------------------------------------------------ */

const fetchCategories = async (type?: "INCOME" | "EXPENSE"): Promise<Category[]> => {
  const params = type ? `?type=${type}` : "";
  const res = await fetch(`/api/categories${params}`);
  if (!res.ok) throw new Error("Failed to fetch categories");
  return res.json();
};

const fetchQuickPreferences = async (): Promise<QuickPreferences> => {
  const res = await fetch("/api/preferences");
  if (!res.ok) throw new Error("Failed to fetch preferences");
  const data = await res.json();
  return {
    quickExpenseCategories: data.quickExpenseCategories ?? [],
    quickIncomeCategories: data.quickIncomeCategories ?? [],
  };
};

/* ------------------------------------------------------------------ */
/*  Query hooks                                                        */
/* ------------------------------------------------------------------ */

/** Cached categories query — pass type to filter, omit for all */
export function useCategoriesQuery(type?: "INCOME" | "EXPENSE") {
  return useQuery({
    queryKey: categoryKeys.byType(type),
    queryFn: () => fetchCategories(type),
  });
}

/** Cached quick-access category preferences */
export function useQuickPreferencesQuery() {
  return useQuery({
    queryKey: categoryKeys.preferences.quick,
    queryFn: fetchQuickPreferences,
  });
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
      queryClient.invalidateQueries({ queryKey: categoryKeys.preferences.quick });
    },
  });
}
