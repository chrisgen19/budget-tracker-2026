import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Plus } from "lucide-react";
import { MobileFab } from "@/components/ui/mobile-fab";
import {
  FAB_BASE_OFFSET_REM,
  getMobileFabBannerClearance,
} from "@/components/ui/bottom-overlay-clearance";

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
  it("renders a compact accessible action and disables it while the page is scrolling", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();

    render(
      <MobileFab
        label="Transaction"
        icon={Plus}
        compact
        hideWhileScrolling
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", { name: "Add Transaction" });
    expect(button.textContent).toBe("");
    expect(button.className).toContain("p-3");
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("min-w-11");
    expect(button.className).toContain("opacity-100");

    fireEvent.scroll(window);
    expect(button.className).toContain("opacity-0");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(180));
    expect(button.className).toContain("opacity-100");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows immediately when scroll hiding is disabled during the debounce", () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <MobileFab
        label="Transaction"
        icon={Plus}
        compact
        hideWhileScrolling
        onClick={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "Add Transaction" });
    fireEvent.scroll(window);
    expect((button as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <MobileFab
        label="Transaction"
        icon={Plus}
        compact
        hideWhileScrolling={false}
        onClick={() => {}}
      />,
    );

    expect(button.className).toContain("opacity-100");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    act(() => vi.advanceTimersByTime(180));
    expect(button.className).toContain("opacity-100");
  });

  it("keeps the labeled variant visible during scroll by default", () => {
    render(<MobileFab label="Bill" icon={Plus} onClick={() => {}} />);

    const button = screen.getByRole("button", { name: "Add Bill" });
    expect(button.textContent).toContain("Bill");
    expect(button.className).toContain("min-h-11");
    expect(button.className).not.toContain("min-w-11");
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

  it("composes its resting offset from the shared clearance helper", () => {
    overlayMocks.install.bannerVisible = true;
    overlayMocks.install.bannerHeight = 100;
    overlayMocks.bills.bannerHeight = 80;

    render(<MobileFab label="Transaction" icon={Plus} onClick={() => {}} />);

    const shared = getMobileFabBannerClearance({
      billBannerHeight: 80,
      installBannerVisible: true,
      installBannerHeight: 100,
    });
    // jsdom's CSSOM rewrites `max()` on round-trip, so compare the expected
    // offset after the same serializer rather than against the raw string.
    const probe = document.createElement("div");
    probe.style.bottom = `calc(${FAB_BASE_OFFSET_REM}rem + ${shared} + env(safe-area-inset-bottom))`;
    expect(probe.style.bottom).not.toBe("");
    expect(screen.getByRole("button", { name: "Add Transaction" }).style.bottom).toBe(
      probe.style.bottom,
    );
  });
});
