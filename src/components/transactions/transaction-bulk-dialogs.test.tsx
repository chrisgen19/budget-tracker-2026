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
        pending={false}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading labels…")).toBeTruthy();
  });

  it("keeps every dismissal path locked while applying labels", () => {
    const onClose = vi.fn();
    render(
      <TransactionBulkLabelsDialog
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

  it("renders label query failures separately and offers retry", () => {
    const refetch = vi.fn();
    mocks.useLabelsQuery.mockReturnValue(queryState({ isError: true, refetch }));
    render(
      <TransactionBulkLabelsDialog
        open
        onClose={vi.fn()}
        selectedCount={2}
        selectedTypes={new Set<"INCOME" | "EXPENSE">(["EXPENSE"])}
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
