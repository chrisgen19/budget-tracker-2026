import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LabelPicker } from "@/components/transactions/label-picker";
import type { LabelWithCountAndSchedules } from "@/types";

const mocks = vi.hoisted(() => ({
  useLabelsQuery: vi.fn(),
  useQuickLabelsQuery: vi.fn(),
}));

vi.mock("@/hooks/use-labels", () => ({
  useLabelsQuery: mocks.useLabelsQuery,
  useQuickLabelsQuery: mocks.useQuickLabelsQuery,
}));

const queryState = (data: unknown, overrides: Record<string, unknown> = {}) => ({
  data,
  isPending: false,
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  ...overrides,
});

const label = (
  id: string,
  name: string,
  transactionCount = 0,
  applicableTo = "BOTH",
  categoryCounts: Record<string, number> = {},
): LabelWithCountAndSchedules => ({
  id,
  name,
  color: "#F5A623",
  applicableTo,
  userId: "user-1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  _count: { transactions: transactionCount },
  schedules: [],
  categoryCounts,
});

const LABELS = [
  label("alpha", "Alpha", 2),
  label("beta", "Beta", 12),
  label("gamma", "Gamma", 8),
  label("delta", "Delta", 1),
  label("epsilon", "Epsilon", 6),
  label("zeta", "Zeta", 0),
  label("eta", "Eta", 4),
  label("theta", "Theta", 3),
];

function ControlledPicker({
  initialIds = [],
  onChange = () => {},
  autoAppliedIds,
  transactionType,
  categoryId,
}: {
  initialIds?: string[];
  onChange?: (ids: string[]) => void;
  autoAppliedIds?: string[];
  transactionType?: "INCOME" | "EXPENSE";
  categoryId?: string;
}) {
  const [selectedIds, setSelectedIds] = useState(initialIds);
  return (
    <LabelPicker
      selectedIds={selectedIds}
      onChange={(ids) => {
        onChange(ids);
        setSelectedIds(ids);
      }}
      autoAppliedIds={autoAppliedIds}
      transactionType={transactionType}
      categoryId={categoryId}
    />
  );
}

describe("LabelPicker", () => {
  beforeEach(() => {
    mocks.useLabelsQuery.mockReturnValue(queryState(LABELS));
    mocks.useQuickLabelsQuery.mockReturnValue(queryState(["delta"]));
  });

  it("keeps pinned and frequently used quick choices in stable positions while toggling", () => {
    render(<ControlledPicker />);

    const quickGroup = screen.getByRole("group", { name: "Quick label choices" });
    const quickNames = () =>
      within(quickGroup)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim());

    expect(quickNames()).toEqual(["Delta", "Beta", "Gamma", "Epsilon"]);
    const beta = within(quickGroup).getByRole("button", { name: "Beta" });
    expect(beta.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(beta);

    expect(quickNames()).toEqual(["Delta", "Beta", "Gamma", "Epsilon"]);
    expect(beta.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  /**
   * The behaviour #304 left unsolved. Restriction could not fix the picker, because the labels
   * that crowd it are envelopes that legitimately span every category. Ordering can: a label used
   * everywhere still ranks first exactly where it is used most.
   */
  describe("category-aware ordering of the quick chips", () => {
    const quickNames = () =>
      within(screen.getByRole("group", { name: "Quick label choices" }))
        .getAllByRole("button")
        .map((button) => button.textContent?.trim());

    it("puts the labels used most in this category first", () => {
      mocks.useLabelsQuery.mockReturnValue(
        queryState([
          // Beta dominates overall but has never been used here; Zeta is rare overall and is what
          // this category actually gets. Ordering by total alone gets this exactly backwards.
          label("beta", "Beta", 500, "BOTH", {}),
          label("zeta", "Zeta", 3, "BOTH", { "cat-transport": 40 }),
          label("eta", "Eta", 2, "BOTH", { "cat-transport": 9 }),
          label("alpha", "Alpha", 1, "BOTH", {}),
        ]),
      );
      render(<ControlledPicker categoryId="cat-transport" />);

      expect(quickNames()).toEqual(["Zeta", "Eta", "Beta", "Alpha"]);
    });

    it("falls back to overall usage for a category with no history", () => {
      mocks.useLabelsQuery.mockReturnValue(
        queryState([
          label("beta", "Beta", 500, "BOTH", {}),
          label("zeta", "Zeta", 3, "BOTH", { "cat-transport": 40 }),
          label("eta", "Eta", 2, "BOTH", { "cat-transport": 9 }),
          label("alpha", "Alpha", 1, "BOTH", {}),
        ]),
      );
      // A category nobody has filed under yet: every per-category count is zero, so the second tier
      // decides. Dropping straight to alphabetical would lead with Alpha and its single use.
      render(<ControlledPicker categoryId="cat-brand-new" />);

      expect(quickNames()).toEqual(["Beta", "Zeta", "Eta", "Alpha"]);
    });

    it("orders by overall usage when no category is chosen yet", () => {
      mocks.useLabelsQuery.mockReturnValue(
        queryState([
          label("beta", "Beta", 500, "BOTH", { "cat-transport": 1 }),
          label("zeta", "Zeta", 3, "BOTH", { "cat-transport": 40 }),
        ]),
      );
      // The form renders this before a category is picked. Unchanged from the old behaviour.
      render(<ControlledPicker />);

      expect(quickNames()).toEqual(["Beta", "Zeta"]);
    });

    it("still offers a label never used in this category", () => {
      // Ranking, not restricting -- the distinction #304 exists to preserve. Alpha has no history
      // anywhere and must remain reachable.
      mocks.useLabelsQuery.mockReturnValue(
        queryState([
          label("zeta", "Zeta", 3, "BOTH", { "cat-transport": 40 }),
          label("alpha", "Alpha", 0, "BOTH", {}),
        ]),
      );
      render(<ControlledPicker categoryId="cat-transport" />);

      expect(quickNames()).toContain("Alpha");
    });
  });

  it("keeps a selected non-quick label visible and removable", () => {
    const onChange = vi.fn();
    render(<ControlledPicker initialIds={["zeta"]} onChange={onChange} />);

    expect(screen.getByText("Also selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Zeta label" }));

    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.queryByText("Also selected")).toBeNull();
  });

  it("opens, searches, and returns without changing the selection", () => {
    const onChange = vi.fn();
    render(<ControlledPicker initialIds={["alpha"]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse all 8 labels" }));
    expect((screen.getByRole("checkbox", { name: "Alpha" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search labels" }), {
      target: { value: "zet" },
    });
    expect(screen.getByRole("checkbox", { name: "Zeta" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Alpha" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to form" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("searchbox", { name: "Search labels" })).toBeNull();
  });

  it("supports selecting and explicitly clearing labels from the full list", () => {
    const onChange = vi.fn();
    render(<ControlledPicker initialIds={["alpha"]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse all 8 labels" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
    expect(onChange).toHaveBeenLastCalledWith(["alpha", "beta"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("filters incompatible labels but keeps an existing incompatible selection removable", () => {
    const expense = label("expense", "Expense only", 1, "EXPENSE");
    const income = label("income", "Income only", 10, "INCOME");
    mocks.useLabelsQuery.mockReturnValue(queryState([expense, income]));
    mocks.useQuickLabelsQuery.mockReturnValue(queryState([]));
    const onChange = vi.fn();

    render(
      <ControlledPicker
        initialIds={["income"]}
        onChange={onChange}
        transactionType="EXPENSE"
      />,
    );

    expect(screen.getByRole("button", { name: "Expense only" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Income only label" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Income only label" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("exposes scheduled quick labels and their pressed state accessibly", () => {
    render(<ControlledPicker initialIds={["delta"]} autoAppliedIds={["delta"]} />);

    const scheduled = screen.getByRole("button", {
      name: "Delta, automatically applied by schedule",
    });
    expect(scheduled.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows loading, failure with retry, and empty feedback instead of disappearing", () => {
    mocks.useLabelsQuery.mockReturnValue(queryState(undefined, { isPending: true, isLoading: true }));
    mocks.useQuickLabelsQuery.mockReturnValue(queryState(undefined, { isPending: true, isLoading: true }));
    const { rerender } = render(<LabelPicker selectedIds={[]} onChange={() => {}} />);
    expect(screen.getByLabelText("Loading labels")).toBeTruthy();

    const refetch = vi.fn();
    mocks.useLabelsQuery.mockReturnValue(queryState(undefined, { isError: true, refetch }));
    mocks.useQuickLabelsQuery.mockReturnValue(queryState([]));
    rerender(<LabelPicker selectedIds={[]} onChange={() => {}} />);
    expect(screen.getByText("Couldn't load labels.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();

    mocks.useLabelsQuery.mockReturnValue(queryState([]));
    rerender(<LabelPicker selectedIds={[]} onChange={() => {}} />);
    expect(screen.getByText(/No labels yet/)).toBeTruthy();
  });

  it("reports when labels exist but none match the transaction type", () => {
    mocks.useLabelsQuery.mockReturnValue(
      queryState([label("income", "Income only", 1, "INCOME")]),
    );
    mocks.useQuickLabelsQuery.mockReturnValue(queryState([]));

    render(
      <LabelPicker selectedIds={[]} onChange={() => {}} transactionType="EXPENSE" />,
    );

    expect(screen.getByText("No labels are available for expenses.")).toBeTruthy();
  });
});
