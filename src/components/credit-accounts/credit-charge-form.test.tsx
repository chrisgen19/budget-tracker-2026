import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  chargeToInput,
  CreditChargeForm,
  statementTotal,
} from "@/components/credit-accounts/credit-charge-form";
import type { CreditChargeInput } from "@/lib/validations";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));

vi.mock("@/hooks/use-categories", () => {
  // Hoisted for a stable identity across renders.
  const categories = [
    { id: "cat-subs", name: "Subscriptions", type: "EXPENSE", icon: "Film", color: "#FF6B6B" },
    { id: "cat-pay", name: "Credit Card Payment", type: "EXPENSE", icon: "CreditCard", color: "#5B6B8C" },
  ];
  return { useCategoriesQuery: () => ({ data: categories, isLoading: false }) };
});

describe("statementTotal", () => {
  it("adds charges and takes refunds off, without float noise", () => {
    expect(
      statementTotal([
        { kind: "CHARGE", amount: 1424.15 },
        { kind: "CHARGE", amount: 1111 },
        { kind: "CHARGE", amount: 382.79 },
        { kind: "CREDIT", amount: 0.1 },
      ])
    ).toBe(2917.84);
  });

  it("counts a blank amount as nothing", () => {
    expect(statementTotal([{ kind: "CHARGE", amount: null }, { kind: "CHARGE" }])).toBe(0);
  });
});

describe("chargeToInput", () => {
  it("edits a stored charge on the account's day, not the UTC day before it", () => {
    const input = chargeToInput(
      {
        id: "charge-1",
        kind: "CHARGE",
        amount: 385,
        description: "Ayala Malls",
        date: "2026-08-24T16:00:00.000Z",
        originalAmount: null,
        originalCurrency: null,
        categoryId: "cat-shop",
        category: { id: "cat-shop", name: "Shopping", icon: "ShoppingBag", color: "#4ECDC4" },
      },
      -480
    );

    expect(input.date).toBe("2026-08-25");
  });
});

describe("CreditChargeForm", () => {
  it("never offers the payment category for a charge", () => {
    render(<CreditChargeForm onSubmit={async () => {}} onCancel={() => {}} />);

    expect(screen.queryByRole("option", { name: "Credit Card Payment" })).toBeNull();
    expect(screen.getByRole("option", { name: "Subscriptions" })).toBeTruthy();
  });

  it("keeps a running total as lines are added", async () => {
    render(<CreditChargeForm onSubmit={async () => {}} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1424.15" } });
    fireEvent.click(screen.getByRole("button", { name: /add another line/i }));
    fireEvent.change(screen.getAllByLabelText("Amount")[1], { target: { value: "1111" } });

    await waitFor(() =>
      expect(screen.getByTestId("statement-total").textContent).toBe("₱2,535.15")
    );
  });

  it("submits parsed lines, with the currency upper-cased", async () => {
    const onSubmit = vi.fn<(charges: CreditChargeInput[]) => Promise<void>>(async () => {});
    render(<CreditChargeForm onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-25" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Anthropic* Claude Sub" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "cat-subs" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1424.15" } });
    fireEvent.change(screen.getByLabelText(/foreign amount/i), { target: { value: "22.40" } });
    fireEvent.change(screen.getByLabelText(/currency/i), { target: { value: "usd" } });
    fireEvent.click(screen.getByRole("button", { name: /add charges/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual([
      {
        kind: "CHARGE",
        amount: 1424.15,
        description: "Anthropic* Claude Sub",
        date: "2026-08-25",
        categoryId: "cat-subs",
        originalAmount: 22.4,
        originalCurrency: "USD",
      },
    ]);
  });

  it("does not submit a line with no amount or category", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<CreditChargeForm onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /add charges/i }));

    await waitFor(() => expect(screen.getByText("Enter an amount above 0")).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
