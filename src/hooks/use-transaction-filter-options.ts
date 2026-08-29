import { useCategoriesQuery } from "@/hooks/use-categories";
import { useLabelsQuery } from "@/hooks/use-labels";
import type { Category, LabelWithCountAndSchedules } from "@/types";

const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_LABELS: LabelWithCountAndSchedules[] = [];

export function useTransactionFilterOptions(type: "ALL" | "INCOME" | "EXPENSE") {
  const categoryType = type === "ALL" ? undefined : type;
  const categoriesQuery = useCategoriesQuery(categoryType);
  const labelsQuery = useLabelsQuery();

  return {
    categories: categoriesQuery.data ?? EMPTY_CATEGORIES,
    categoriesPending: categoriesQuery.isPending,
    categoriesError: categoriesQuery.isError,
    retryCategories: categoriesQuery.refetch,
    labels: labelsQuery.data ?? EMPTY_LABELS,
    labelsPending: labelsQuery.isPending,
    labelsError: labelsQuery.isError,
    retryLabels: labelsQuery.refetch,
  };
}

export type TransactionFilterOptions = ReturnType<typeof useTransactionFilterOptions>;
