import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionSelectionCheckbox } from "@/components/transactions/transaction-selection-checkbox";

describe("TransactionSelectionCheckbox", () => {
  it("exposes an accessible checked state and Space/click activation", () => {
    const onChange = vi.fn();
    render(
      <TransactionSelectionCheckbox
        label="Select Groceries transaction"
        state="all"
        onChange={onChange}
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Select Groceries transaction" });
    expect(checkbox).toHaveProperty("checked", true);
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("sets the native indeterminate state for a partial selection", () => {
    render(
      <TransactionSelectionCheckbox label="Select visible transactions" state="some" onChange={() => {}} />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Select visible transactions" }),
    ).toHaveProperty("indeterminate", true);
  });
});
