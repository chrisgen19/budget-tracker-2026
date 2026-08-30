import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionBulkActionBar } from "@/components/transactions/transaction-bulk-action-bar";

vi.mock("@/components/bills/bill-reminder-provider", () => ({
  useBillReminders: () => ({ bannerHeight: 0 }),
}));

vi.mock("@/components/pwa/install-banner-context", () => ({
  useInstallBanner: () => ({ bannerVisible: false, bannerHeight: 0 }),
}));

const renderBar = (editPending: boolean) => {
  const onCategory = vi.fn();
  const onLabels = vi.fn();
  const onDelete = vi.fn();
  render(
    <TransactionBulkActionBar
      selectedCount={1}
      visibleCount={1}
      matchingCount={1}
      visibleState="all"
      layout="pagination"
      allMatchingPending={false}
      editPending={editPending}
      exportPending={false}
      updatePending={false}
      onToggleVisible={vi.fn()}
      onSelectAllMatching={vi.fn()}
      onEdit={vi.fn()}
      onCategory={onCategory}
      onLabels={onLabels}
      onExport={vi.fn()}
      onDelete={onDelete}
      onClear={vi.fn()}
    />,
  );
  return { onCategory, onLabels, onDelete };
};

describe("TransactionBulkActionBar", () => {
  it("disables dialog-opening actions while edit details load", () => {
    const handlers = renderBar(true);

    for (const name of ["Category", "Labels", "Delete"]) {
      const buttons = screen.getAllByRole<HTMLButtonElement>("button", { name });
      expect(buttons).toHaveLength(2);
      expect(buttons.every((button) => button.disabled)).toBe(true);
      buttons.forEach((button) => fireEvent.click(button));
    }

    expect(handlers.onCategory).not.toHaveBeenCalled();
    expect(handlers.onLabels).not.toHaveBeenCalled();
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });
});
