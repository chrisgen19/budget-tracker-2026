import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaidWithField } from "@/components/transactions/paid-with-field";

const cardsQuery = vi.hoisted(() => vi.fn());

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));
vi.mock("@/components/privacy-provider", () => ({ usePrivacy: () => ({ hideAmounts: false }) }));
vi.mock("@/hooks/use-credit-accounts", () => ({ useCreditAccountsQuery: cardsQuery }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const BPI = { id: "card-1", name: "BPI", color: "#5B6B8C", balance: 76566.08 };

describe("PaidWithField", () => {
  // The transaction form is shared by receipts, bills and quick add; none should fetch cards.
  it("fetches no cards while closed", () => {
    cardsQuery.mockReset();
    render(<PaidWithField value={null} onChange={() => {}} />);

    expect(screen.getByRole("button", { name: /Bank \/ cash/ })).toBeTruthy();
    expect(cardsQuery).not.toHaveBeenCalled();
  });

  it("names the linked card while closed, without fetching", () => {
    cardsQuery.mockReset();
    render(<PaidWithField value="card-1" onChange={() => {}} linkedCardName="BPI" />);

    expect(screen.getByRole("button", { name: /BPI/ })).toBeTruthy();
    expect(cardsQuery).not.toHaveBeenCalled();
  });

  it("offers bank or cash and each card once opened", () => {
    cardsQuery.mockReturnValue({ data: [BPI], isLoading: false, isError: false });
    const onChange = vi.fn();
    render(<PaidWithField value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Bank \/ cash/ }));
    fireEvent.click(screen.getByRole("radio", { name: /BPI/ }));

    expect(onChange).toHaveBeenCalledWith("card-1");
    expect(screen.getByRole("radio", { name: /Bank \/ cash/ }).getAttribute("aria-checked")).toBe("true");
  });
});
