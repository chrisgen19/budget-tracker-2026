import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Plus } from "lucide-react";
import { MobileFab } from "@/components/ui/mobile-fab";
import { getMobileFabBottom } from "@/components/ui/bottom-overlay-clearance";

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
    // `disabled` is instant, so the fade out has to be quick or the button
    // spends the transition looking tappable while ignoring taps.
    expect(button.className).toContain("duration-100");
    expect(button.className).not.toContain("duration-300");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(180));
    expect(button.className).toContain("opacity-100");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.className).toContain("duration-300");
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

  it("is compact and scroll-aware with no props, which is what every page relies on", () => {
    vi.useFakeTimers();

    render(<MobileFab label="Bill" icon={Plus} onClick={() => {}} />);

    const button = screen.getByRole("button", { name: "Add Bill" });
    expect(button.textContent).toBe("");
    expect(button.className).toContain("min-w-11");
    fireEvent.scroll(window);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    act(() => vi.advanceTimersByTime(180));
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders the labeled, always-visible variant when both are opted out", () => {
    render(
      <MobileFab
        label="Bill"
        icon={Plus}
        compact={false}
        hideWhileScrolling={false}
        onClick={() => {}}
      />,
    );

    const button = screen.getByRole("button", { name: "Add Bill" });
    expect(button.textContent).toContain("Bill");
    expect(button.className).toContain("min-h-11");
    expect(button.className).not.toContain("min-w-11");
    fireEvent.scroll(window);
    expect(button.className).toContain("opacity-100");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("stacks above bill and install banners instead of overlapping them", () => {
    const offsetFor = (install: boolean, installHeight: number, billHeight: number) => {
      overlayMocks.install.bannerVisible = install;
      overlayMocks.install.bannerHeight = installHeight;
      overlayMocks.bills.bannerHeight = billHeight;
      const { unmount } = render(<MobileFab label="Transaction" icon={Plus} onClick={() => {}} />);
      const bottom = screen.getByRole("button", { name: "Add Transaction" }).style.bottom;
      unmount();
      return bottom;
    };

    const resting = offsetFor(false, 0, 0);
    const raised = offsetFor(true, 100, 80);
    expect(resting).toContain("safe-area-inset-bottom");
    expect(raised).toContain("safe-area-inset-bottom");
    // Banner state has to reach the rendered offset; the exact geometry is
    // covered in bottom-overlay-clearance.test.ts.
    expect(raised).not.toBe(resting);
  });

  it("composes its resting offset from the shared clearance helper", () => {
    overlayMocks.install.bannerVisible = true;
    overlayMocks.install.bannerHeight = 100;
    overlayMocks.bills.bannerHeight = 80;

    render(<MobileFab label="Transaction" icon={Plus} onClick={() => {}} />);

    const shared = getMobileFabBottom({
      billBannerHeight: 80,
      installBannerVisible: true,
      installBannerHeight: 100,
    });
    // jsdom's CSSOM rewrites `max()` on round-trip, so compare the expected
    // offset after the same serializer rather than against the raw string.
    const probe = document.createElement("div");
    probe.style.bottom = `calc(${shared} + env(safe-area-inset-bottom))`;
    expect(probe.style.bottom).not.toBe("");
    expect(screen.getByRole("button", { name: "Add Transaction" }).style.bottom).toBe(
      probe.style.bottom,
    );
  });
});
