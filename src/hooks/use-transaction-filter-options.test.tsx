import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTransactionFilterOptions } from "@/hooks/use-transaction-filter-options";

const queryMocks = vi.hoisted(() => ({
  useCategoriesQuery: vi.fn(),
  useLabelsQuery: vi.fn(),
}));

vi.mock("@/hooks/use-categories", () => ({
  useCategoriesQuery: queryMocks.useCategoriesQuery,
}));

vi.mock("@/hooks/use-labels", () => ({
  useLabelsQuery: queryMocks.useLabelsQuery,
}));

beforeEach(() => {
  queryMocks.useCategoriesQuery.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  queryMocks.useLabelsQuery.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe("useTransactionFilterOptions", () => {
  it("keys category data by the selected transaction type", () => {
    const initialProps: { type: "ALL" | "INCOME" | "EXPENSE" } = { type: "INCOME" };
    const { rerender } = renderHook(
      ({ type }: { type: "ALL" | "INCOME" | "EXPENSE" }) =>
        useTransactionFilterOptions(type),
      { initialProps },
    );
    expect(queryMocks.useCategoriesQuery).toHaveBeenLastCalledWith("INCOME");

    rerender({ type: "EXPENSE" });
    expect(queryMocks.useCategoriesQuery).toHaveBeenLastCalledWith("EXPENSE");

    rerender({ type: "ALL" });
    expect(queryMocks.useCategoriesQuery).toHaveBeenLastCalledWith(undefined);
  });

  it("exposes category loading and error states without local fallback data", () => {
    const retry = vi.fn();
    queryMocks.useCategoriesQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: retry,
    });

    const { result } = renderHook(() => useTransactionFilterOptions("EXPENSE"));

    expect(result.current.categories).toEqual([]);
    expect(result.current.categoriesError).toBe(true);
    expect(result.current.retryCategories).toBe(retry);
  });
});
