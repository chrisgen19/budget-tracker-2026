import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useCategoriesQuery: vi.fn(),
  useLabelsQuery: vi.fn(),
}));

vi.mock("@/hooks/use-categories", () => ({
  useCategoriesQuery: mocks.useCategoriesQuery,
}));

vi.mock("@/hooks/use-labels", () => ({
  useLabelsQuery: mocks.useLabelsQuery,
}));

vi.mock("@/components/ui/modal", () => ({
  Modal: ({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) =>
    open ? (
      <div>
        <button type="button" onClick={onClose}>Dismiss modal</button>
        {children}
      </div>
    ) : null,
}));

import {
  TransactionBulkCategoryDialog,
  TransactionBulkLabelsDialog,
} from "@/components/transactions/transaction-bulk-dialogs";

const queryState = (overrides: Record<string, unknown> = {}) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  ...overrides,
});

describe("TransactionBulkLabelsDialog", () => {
  beforeEach(() => {
    mocks.useCategoriesQuery.mockReturnValue(queryState({ data: [] }));
    mocks.useLabelsQuery.mockReturnValue(queryState({ isLoading: true }));
  });

  it("does not enter an update loop while labels are loading", () => {
    render(
      <TransactionBulkLabelsDialog
        open
        onClose={vi.fn()}
        selectedCount={2}
        selectedTypes={new Set<"INCOME" | "EXPENSE">(["EXPENSE"])}
        selectedCategoryIds={new Set<string>(["cat_1"])}
        pending={false}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading labels…")).toBeTruthy();
  });

  // The write is all-or-nothing: `PATCH /api/transactions/batch` refuses an add whose label does
  // not cover every selected row. Offering such a label here would put the user one press away
  // from a guaranteed 409, with nothing on screen explaining which label caused it.
  it("hides a label that does not cover every selected category, in add mode", () => {
    const label = (id: string, name: string, categoryIds: string[]) => ({
      id,
      name,
      color: "#F5A623",
      applicableTo: "EXPENSE",
      userId: "u1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      _count: { transactions: 0 },
      schedules: [],
      categories: categoryIds.map((categoryId) => ({ categoryId })),
    });
    mocks.useLabelsQuery.mockReturnValue(
      queryState({
        data: [
          label("tnvs", "TNVS", ["cat_transport"]),
          label("both", "Covers Both", ["cat_transport", "cat_food"]),
          label("anywhere", "Anywhere", []),
        ],
      }),
    );

    render(
      <TransactionBulkLabelsDialog
        open
        onClose={vi.fn()}
        selectedCount={2}
        selectedTypes={new Set<"INCOME" | "EXPENSE">(["EXPENSE"])}
        selectedCategoryIds={new Set<string>(["cat_transport", "cat_food"])}
        pending={false}
        onApply={vi.fn()}
      />,
    );

    expect(screen.queryByText("TNVS")).toBeNull();
    expect(screen.getByText("Covers Both")).toBeTruthy();
    expect(screen.getByText("Anywhere")).toBeTruthy();
  });

  // Remove mode stays unfiltered: taking a label off rows it should never have carried is how a
  // mismatch left by an earlier restriction gets cleaned up, so hiding it removes the only cure.
  it("still offers a non-covering label in remove mode", () => {
    const label = {
      id: "tnvs",
      name: "TNVS",
      color: "#F5A623",
      applicableTo: "EXPENSE",
      userId: "u1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      _count: { transactions: 0 },
      schedules: [],
      categories: [{ categoryId: "cat_transport" }],
    };
    mocks.useLabelsQuery.mockReturnValue(queryState({ data: [label] }));

    render(
      <TransactionBulkLabelsDialog
        open
        onClose={vi.fn()}
        selectedCount={2}
        selectedTypes={new Set<"INCOME" | "EXPENSE">(["EXPENSE"])}
        selectedCategoryIds={new Set<string>(["cat_food"])}
        pending={false}
        onApply={vi.fn()}
      />,
    );

    expect(screen.queryByText("TNVS")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(screen.getByText("TNVS")).toBeTruthy();
  });

  it("keeps every dismissal path locked while applying labels", () => {
    const onClose = vi.fn();
    render(
      <TransactionBulkLabelsDialog
        open
        onClose={onClose}
        selectedCount={2}
        selectedTypes={new Set<"INCOME" | "EXPENSE">(["EXPENSE"])}
        selectedCategoryIds={new Set<string>(["cat_1"])}
        pending
        onApply={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss modal" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders label query failures separately and offers retry", () => {
    const refetch = vi.fn();
    mocks.useLabelsQuery.mockReturnValue(queryState({ isError: true, refetch }));
    render(
      <TransactionBulkLabelsDialog
        open
        onClose={vi.fn()}
        selectedCount={2}
        selectedTypes={new Set<"INCOME" | "EXPENSE">(["EXPENSE"])}
        selectedCategoryIds={new Set<string>(["cat_1"])}
        pending={false}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByText("Could not load labels.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe("TransactionBulkCategoryDialog", () => {
  beforeEach(() => {
    mocks.useCategoriesQuery.mockReturnValue(queryState({ data: [] }));
    mocks.useLabelsQuery.mockReturnValue(queryState({ data: [] }));
  });

  it("distinguishes an empty category result from loading and errors", () => {
    render(
      <TransactionBulkCategoryDialog
        open
        onClose={vi.fn()}
        selectedCount={2}
        selectedTypes={new Set<"INCOME" | "EXPENSE">(["EXPENSE"])}
        pending={false}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByText("No expense categories are available.")).toBeTruthy();
  });

  it("renders category failures separately and offers retry", () => {
    const refetch = vi.fn();
    mocks.useCategoriesQuery.mockReturnValue(queryState({ isError: true, refetch }));
    render(
      <TransactionBulkCategoryDialog
        open
        onClose={vi.fn()}
        selectedCount={2}
        selectedTypes={new Set<"INCOME" | "EXPENSE">(["EXPENSE"])}
        pending={false}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByText("Could not load categories.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("keeps every dismissal path locked while applying a category", () => {
    const onClose = vi.fn();
    render(
      <TransactionBulkCategoryDialog
        open
        onClose={onClose}
        selectedCount={2}
        selectedTypes={new Set<"INCOME" | "EXPENSE">(["EXPENSE"])}
        pending
        onApply={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss modal" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
