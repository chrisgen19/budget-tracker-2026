import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardPurchasesForm, purchasesTotal } from "@/components/credit-accounts/card-purchases-form";
import type { CardPurchaseLine } from "@/lib/validations";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));

vi.mock("@/hooks/use-categories", () => {
  // Hoisted for a stable identity across renders.
  const categories = [{ id: "cat-subs", name: "Subscriptions", type: "EXPENSE", icon: "Film", color: "#FF6B6B" }];
  return { useCategoriesQuery: () => ({ data: categories, isLoading: false }) };
});

vi.mock("@/hooks/use-labels", () => {
  const labels = [
    { id: "label-personal", name: "Personal", color: "#8B6FC0", applicableTo: "EXPENSE" },
    { id: "label-salary", name: "Payroll", color: "#2D8B5A", applicableTo: "INCOME" },
  ];
  return { useLabelsQuery: () => ({ data: labels }) };
});

describe("purchasesTotal", () => {
  it("adds the lines without float noise, and counts a blank amount as nothing", () => {
    expect(purchasesTotal([{ amount: 1424.15 }, { amount: 1111 }, { amount: 382.79 }, { amount: null }])).toBe(2917.94);
  });
});

describe("CardPurchasesForm", () => {
  it("keeps a running total as lines are added", async () => {
    render(<CardPurchasesForm onSubmit={async () => {}} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1424.15" } });
    fireEvent.click(screen.getByRole("button", { name: /add another line/i }));
    fireEvent.change(screen.getAllByLabelText("Amount")[1], { target: { value: "1111" } });

    await waitFor(() => expect(screen.getByTestId("purchases-total").textContent).toBe("₱2,535.15"));
  });

  it("offers expense labels only, and submits the ones chosen", async () => {
    const onSubmit = vi.fn<(lines: CardPurchaseLine[]) => Promise<void>>(async () => {});
    render(<CardPurchasesForm onSubmit={onSubmit} onCancel={() => {}} />);

    expect(screen.queryByRole("button", { name: /Payroll/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-25" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Google One" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "cat-subs" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1111" } });
    fireEvent.click(screen.getByRole("button", { name: /Personal/ }));
    fireEvent.click(screen.getByRole("button", { name: /add purchases/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { date: "2026-08-25", description: "Google One", categoryId: "cat-subs", amount: 1111, labelIds: ["label-personal"] },
    ]);
  });

  it("does not submit a line with no amount or category", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<CardPurchasesForm onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /add purchases/i }));

    await waitFor(() => expect(screen.getByText("Enter an amount above 0")).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
