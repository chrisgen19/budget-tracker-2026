import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useLabelsQuery: vi.fn(),
}));

vi.mock("@/hooks/use-labels", () => ({
  useLabelsQuery: mocks.useLabelsQuery,
}));

vi.mock("@/components/ui/modal", () => ({
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));

import { TransactionBulkLabelsDialog } from "@/components/transactions/transaction-bulk-dialogs";

describe("TransactionBulkLabelsDialog", () => {
  beforeEach(() => {
    mocks.useLabelsQuery.mockReturnValue({ data: undefined, isLoading: true });
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
});
