import { describe, expect, it, vi } from "vitest";
import { buildFilterChips } from "@/components/transactions/transaction-filter-chips";
import type { TransactionFilters } from "@/components/transactions/transaction-filters";

const baseFilters: TransactionFilters = {
  search: "",
  type: "ALL",
  month: "2026-08",
  categoryId: null,
  labelId: null,
  createdVia: "ALL",
  amountMin: null,
  amountMax: null,
  sortBy: "date",
  sortDir: "desc",
};

const build = (
  filters: Partial<TransactionFilters>,
  overrides: { categoryName?: string | null; labelName?: string | null } = {},
) => {
  const update = vi.fn();
  const onRemoveSearch = vi.fn();
  const chips = buildFilterChips({
    filters: { ...baseFilters, ...filters },
    categoryName: overrides.categoryName ?? null,
    labelName: overrides.labelName ?? null,
    currencySymbol: "₱",
    update,
    onRemoveSearch,
  });
  return { chips, update, onRemoveSearch };
};

describe("buildFilterChips", () => {
  it("produces no chips for the default filters", () => {
    expect(build({}).chips).toEqual([]);
  });

  it("orders chips the way the toolbar presents them", () => {
    const { chips } = build(
      {
        search: "grab",
        type: "EXPENSE",
        categoryId: "c1",
        labelId: "l1",
        createdVia: "TELEGRAM",
        amountMin: 100,
        sortBy: "amount",
        sortDir: "asc",
      },
      { categoryName: "Transport", labelName: "Work" },
    );

    expect(chips.map((chip) => chip.id)).toEqual([
      "search",
      "type",
      "category",
      "label",
      "source",
      "amount",
      "sort",
    ]);
    expect(chips.map((chip) => chip.label)).toEqual([
      "Search: grab",
      "Expenses",
      "Category: Transport",
      "Label: Work",
      "Source: Telegram",
      "Amount: ₱100+",
      "Sort: Lowest amount",
    ]);
  });

  it("omits a category or label chip while its name is still unresolved", () => {
    const { chips } = build({ categoryId: "c1", labelId: "l1" });
    expect(chips).toEqual([]);
  });

  it("labels each amount bound combination", () => {
    expect(build({ amountMin: 50, amountMax: 200 }).chips[0].label).toBe("Amount: ₱50–₱200");
    expect(build({ amountMin: 50 }).chips[0].label).toBe("Amount: ₱50+");
    expect(build({ amountMax: 200 }).chips[0].label).toBe("Amount: Up to ₱200");
  });

  it("resets both bounds when the amount chip is removed", () => {
    const { chips, update } = build({ amountMin: 50, amountMax: 200 });
    chips[0].onRemove();
    expect(update).toHaveBeenCalledWith({ amountMin: null, amountMax: null });
  });

  it("delegates search removal to the caller so the debounce is cancelled too", () => {
    const { chips, update, onRemoveSearch } = build({ search: "grab" });
    chips[0].onRemove();
    expect(onRemoveSearch).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });
});
