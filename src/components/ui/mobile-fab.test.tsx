import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Plus } from "lucide-react";
import { MobileFab } from "@/components/ui/mobile-fab";

const overlayMocks = vi.hoisted(() => ({
  install: { bannerVisible: false, bannerHeight: 0 },
  bills: { bannerHeight: 0 },
}));

vi.mock("@/components/pwa/install-banner-context", () => ({
  useInstallBanner: () => overlayMocks.install,
}));

vi.mock("@/components/bills/bill-reminder-provider", () => ({
  useBillReminders: () => overlayMocks.bills,
}));

beforeEach(() => {
  overlayMocks.install.bannerVisible = false;
  overlayMocks.install.bannerHeight = 0;
  overlayMocks.bills.bannerHeight = 0;
});

afterEach(() => vi.useRealTimers());

describe("MobileFab responsive behavior", () => {
  it("renders a compact accessible action and clears it while the page is scrolling", () => {
    vi.useFakeTimers();

    render(
      <MobileFab
        label="Transaction"
        icon={Plus}
        compact
        hideWhileScrolling
        onClick={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "Add Transaction" });
    expect(button.textContent).toBe("");
    expect(button.className).toContain("p-3");
    expect(button.className).toContain("opacity-100");

    fireEvent.scroll(window);
    expect(button.className).toContain("opacity-0");
    expect(button.className).toContain("pointer-events-none");

    act(() => vi.advanceTimersByTime(180));
    expect(button.className).toContain("opacity-100");
    expect(button.className).not.toContain("pointer-events-none");
  });

  it("keeps the labeled variant visible during scroll by default", () => {
    render(<MobileFab label="Bill" icon={Plus} onClick={() => {}} />);

    const button = screen.getByRole("button", { name: "Add Bill" });
    expect(button.textContent).toContain("Bill");
    fireEvent.scroll(window);
    expect(button.className).toContain("opacity-100");
  });

  it("stacks above bill and install banners instead of overlapping them", () => {
    overlayMocks.install.bannerVisible = true;
    overlayMocks.install.bannerHeight = 100;
    overlayMocks.bills.bannerHeight = 80;

    render(<MobileFab label="Transaction" icon={Plus} onClick={() => {}} />);

    const bottom = screen.getByRole("button", { name: "Add Transaction" }).style.bottom;
    expect(bottom).toContain("92px");
    expect(bottom).toContain("112px");
    expect(bottom).toContain("safe-area-inset-bottom");
  });
});
