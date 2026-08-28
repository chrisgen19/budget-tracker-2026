import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillReminderBanner } from "@/components/bills/bill-reminder-banner";

vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => ({ hideAmounts: false }),
}));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({
    user: { currency: "PHP", timezoneOffset: 420 },
  }),
}));

vi.mock("@/components/bills/bill-reminder-provider", () => ({
  useBillReminders: () => ({
    pendingReminders: [
      {
        dueDate: "2026-09-05T00:00:00.000Z",
        isOverdue: false,
        daysPastDue: 0,
        daysUntilDue: 8,
        scheduledTransaction: {
          id: "bill-1",
          amount: 1200,
          description: "Internet",
          type: "EXPENSE",
          categoryId: "utilities",
          category: {
            name: "Utilities",
            icon: "zap",
            color: "#000000",
          },
        },
      },
    ],
    currentIndex: 0,
    setCurrentIndex: vi.fn(),
    handlePay: vi.fn(),
    handleSnooze: vi.fn(),
    handleSkip: vi.fn(),
    handlePayAll: vi.fn(),
    isActioning: false,
    payAllProgress: null,
    setBannerHeight: vi.fn(),
    dismissedForToday: false,
    dismissForToday: vi.fn(),
  }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("BillReminderBanner account-local dates", () => {
  it("prefills Pay & Edit with the saved account clock", () => {
    vi.stubEnv("TZ", "UTC");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T00:30:00.000Z"));
    const onPayAndEdit = vi.fn();

    render(<BillReminderBanner onPayAndEdit={onPayAndEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Pay & Edit" }));

    expect(onPayAndEdit).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-09-05T17:30" }),
    );
  });
});
