import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CardDetailPage from "@/app/(app)/cards/[id]/page";
import type { CreditAccountDetailView } from "@/hooks/use-credit-accounts";

const hooks = vi.hoisted(() => ({
  detailQuery: vi.fn(),
  updatePayment: vi.fn(),
  recordPayment: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "card-1" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP", timezoneOffset: -480 } }),
}));
vi.mock("@/components/privacy-provider", () => ({ usePrivacy: () => ({ hideAmounts: false }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ showToast: hooks.showToast }) }));
vi.mock("@/hooks/use-card-purchase-batch", () => ({
  useCardPurchaseBatch: () => ({ unconfirmed: null, saving: false, submit: vi.fn(), retry: vi.fn(), discard: vi.fn() }),
}));
vi.mock("@/hooks/use-record-card-payment", () => ({
  useRecordCardPayment: () => ({ submit: hooks.recordPayment }),
}));
vi.mock("@/hooks/use-credit-accounts", () => {
  const idle = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useCreditAccountDetailQuery: hooks.detailQuery,
    useUpdateCreditPayment: () => ({ mutateAsync: hooks.updatePayment, isPending: false }),
    useDeleteCreditPayment: idle,
    useUpdateCreditAccount: idle,
    useDeleteCreditAccount: idle,
  };
});

const DETAIL: CreditAccountDetailView = {
  account: {
    id: "card-1",
    name: "BPI",
    color: "#E05B8D",
    creditLimit: 94000,
    statementDay: 7,
    dueDay: 28,
    apr: null,
    minimumPaymentPct: null,
    minimumPaymentFloor: null,
    plannedPayment: null,
    openingBalance: 74270.8,
    openingBalanceDate: "2026-08-05T16:00:00.000Z",
    isActive: true,
    billId: null,
    balance: 76566.08,
    availableCredit: 17433.92,
    utilization: 81.5,
    totals: { purchases: 7295.28, payments: 5000, credits: 0 },
  },
  period: {
    month: "2026-09",
    start: "2026-08-31T16:00:00.000Z",
    end: "2026-09-30T15:59:59.999Z",
    totals: { purchases: 0, payments: 5000, credits: 0 },
  },
  purchases: [],
  // Stored at the start of 14 September in Manila.
  payments: [{ id: "pay-1", kind: "PAYMENT", amount: 5000, description: "BPI payment", date: "2026-09-13T16:00:00.000Z" }],
  truncated: false,
  categoryBreakdown: [],
  labelBreakdown: [],
  interest: { period: 0, everLogged: false },
  observedPayment: { monthly: null, months: 0 },
};

beforeEach(() => {
  // Only Date is faked, so the form's async validation and `waitFor` keep real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-28T04:00:00.000Z"));
  hooks.detailQuery.mockReturnValue({ isLoading: false, isError: false, isFetching: false, data: DETAIL, refetch: vi.fn() });
  hooks.updatePayment.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

const lastMonthRequested = () => hooks.detailQuery.mock.calls.at(-1)?.[1];

describe("CardDetailPage", () => {
  it("follows a payment whose date is corrected into another month, as recording one does", async () => {
    render(<CardDetailPage />);
    expect(lastMonthRequested()).toBe("2026-09");

    fireEvent.click(screen.getByRole("button", { name: "Edit BPI payment" }));
    fireEvent.change(await screen.findByLabelText("Date"), { target: { value: "2026-08-30" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(hooks.updatePayment).toHaveBeenCalledWith({
        accountId: "card-1",
        paymentId: "pay-1",
        patch: expect.objectContaining({ date: "2026-08-30" }),
      })
    );
    // Without this the row just vanishes from September, with only "Payment updated" to go on.
    await waitFor(() => expect(lastMonthRequested()).toBe("2026-08"));
  });

  it("stays on the month when a failed correction leaves the payment where it was", async () => {
    hooks.updatePayment.mockRejectedValue(new Error("Failed to update the payment"));
    render(<CardDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "Edit BPI payment" }));
    fireEvent.change(await screen.findByLabelText("Date"), { target: { value: "2026-08-30" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    // The toast, not the call: the page handles the rejection a tick after the call is made, and a
    // month switched regardless of the outcome would land after an assertion made at the call.
    await waitFor(() => expect(hooks.showToast).toHaveBeenCalledWith("Failed to update the payment", "error"));
    expect(lastMonthRequested()).toBe("2026-09");
    // The form stays open to try again.
    expect(screen.getByRole("button", { name: /save/i })).toBeTruthy();
  });

  describe("recording a payment", () => {
    const recordOnePeso = async () => {
      render(<CardDetailPage />);
      fireEvent.click(screen.getByRole("button", { name: "Pay" }));
      fireEvent.change(await screen.findByLabelText(/Amount/), { target: { value: "1" } });
      fireEvent.click(screen.getByRole("button", { name: /record/i }));
      await waitFor(() => expect(hooks.recordPayment).toHaveBeenCalled());
    };

    it("keeps the form open after an unconfirmed save, saying Record is safe to press again", async () => {
      hooks.recordPayment.mockResolvedValue({ outcome: "unconfirmed" });

      await recordOnePeso();

      await waitFor(() =>
        expect(hooks.showToast).toHaveBeenCalledWith(expect.stringMatching(/won't be counted twice/), "error")
      );
      expect(screen.getByRole("button", { name: /record/i })).toBeTruthy();
    });

    it("closes on the month an earlier attempt landed in, and says the edits were not saved", async () => {
      hooks.recordPayment.mockResolvedValue({
        outcome: "earlier-attempt-saved",
        payment: { id: "pay-2", kind: "PAYMENT", amount: 5000, description: "", date: "2026-08-29T16:00:00.000Z" },
      });

      await recordOnePeso();

      await waitFor(() => expect(lastMonthRequested()).toBe("2026-08"));
      expect(hooks.showToast).toHaveBeenCalledWith(expect.stringMatching(/weren't saved/), "error");
      // Gone once the modal's exit animation has run.
      await waitFor(() => expect(screen.queryByRole("button", { name: /record/i })).toBeNull());
    });
  });
});
