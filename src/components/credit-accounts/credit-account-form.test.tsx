import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreditAccountForm } from "@/components/credit-accounts/credit-account-form";
import type { CreditAccountInput } from "@/lib/validations";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));

describe("CreditAccountForm", () => {
  it("sends blank optional numbers as null, not 0 or NaN", async () => {
    const onSubmit = vi.fn<(data: CreditAccountInput) => Promise<void>>(async () => {});
    render(<CreditAccountForm onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText("Card name"), { target: { value: "BPI Credit Card" } });
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: "BPI Credit Card",
      creditLimit: null,
      statementDay: null,
      dueDay: null,
      openingBalance: 0,
    });
  });

  it("refuses a due day past 31 without submitting", async () => {
    const onSubmit = vi.fn(async () => {});
    render(<CreditAccountForm onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText("Card name"), { target: { value: "BPI" } });
    fireEvent.change(screen.getByLabelText(/due day/i), { target: { value: "32" } });
    fireEvent.click(screen.getByRole("button", { name: /add card/i }));

    await waitFor(() => expect(screen.getByLabelText(/due day/i)).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a stored opening date as the account's day, not the UTC day before it", () => {
    render(
      <CreditAccountForm
        account={{
          id: "card-1",
          name: "BPI",
          color: "#5B6B8C",
          creditLimit: 50000,
          statementDay: 10,
          dueDay: 5,
          openingBalance: 1200,
          // Midnight on 1 September in Manila, which is still 31 August in UTC.
          openingBalanceDate: "2026-08-31T16:00:00.000Z",
          isActive: true,
          billId: null,
          balance: 1200,
          availableCredit: 48800,
          totals: { charges: 0, credits: 0, payments: 0 },
        }}
        onSubmit={async () => {}}
        onCancel={() => {}}
      />
    );

    expect((screen.getByLabelText("As of") as HTMLInputElement).value).toBe("2026-09-01");
  });
});
