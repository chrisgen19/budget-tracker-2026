import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Plus, ScanLine } from "lucide-react";
import { ActionFab } from "@/components/ui/action-fab";
import { getFabBottom, getFabBottomDesktop } from "@/components/ui/bottom-overlay-clearance";

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

/**
 * Which side of `sm` the component thinks it is on. Visibility is the one part
 * of the FAB that CSS cannot express -- "scrolled past" is not a media query --
 * so it reads the breakpoint through `matchMedia` and the tests drive it here.
 */
type MediaListener = EventListenerOrEventListenerObject;

let mediaListeners: Array<[MediaListener, () => void]> = [];
let mediaMatches = false;

const setViewport = (desktop: boolean) => {
  mediaMatches = desktop;
  mediaListeners = [];
  window.matchMedia = ((query: string) =>
    ({
      // A getter, not a snapshot: the component reads `matches` when its own
      // change listener fires, which is the whole point of crossBreakpoint.
      get matches() {
        return mediaMatches;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: MediaListener) => {
        mediaListeners.push([listener, () => (listener as EventListener)(new Event("change"))]);
      },
      removeEventListener: (_type: string, listener: MediaListener) => {
        mediaListeners = mediaListeners.filter(([registered]) => registered !== listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
};

/** Cross the `sm` boundary on a mounted component, the way a resize or a device rotation does. */
const crossBreakpoint = (desktop: boolean) => {
  mediaMatches = desktop;
  act(() => mediaListeners.forEach(([, fire]) => fire()));
};

const scrollTo = (y: number) => {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  fireEvent.scroll(window);
};

const menuItems = [
  { label: "Add Transaction", icon: Plus, onClick: vi.fn() },
  { label: "Scan Receipt", icon: ScanLine, onClick: vi.fn() },
];

beforeEach(() => {
  overlayMocks.install.bannerVisible = false;
  overlayMocks.install.bannerHeight = 0;
  overlayMocks.bills.bannerHeight = 0;
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  setViewport(false);
  menuItems.forEach((item) => item.onClick.mockClear());
});

afterEach(() => vi.useRealTimers());

describe("ActionFab below sm", () => {
  it("renders a compact accessible action and disables it while the page is scrolling", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();

    render(
      <ActionFab
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
      <ActionFab
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
      <ActionFab
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

    render(<ActionFab label="Bill" icon={Plus} onClick={() => {}} />);

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
      <ActionFab
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

  it("stays a single action even when given menu items, since the tab bar already carries scan", () => {
    const onClick = vi.fn();

    render(
      <ActionFab label="Transaction" icon={Plus} items={menuItems} onClick={onClick} />,
    );

    const button = screen.getByRole("button", { name: "Add Transaction" });
    expect(button.getAttribute("aria-haspopup")).toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("ActionFab at sm and above", () => {
  beforeEach(() => setViewport(true));

  it("stays hidden at the top of the page, where the header button is still on screen", () => {
    render(<ActionFab label="Transaction" icon={Plus} onClick={() => {}} />);

    const button = screen.getByRole("button", { name: "Add Transaction" });
    expect(button.className).toContain("opacity-0");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // A hidden button must not swallow clicks meant for the page beneath it.
    expect(button.parentElement?.className).toContain("pointer-events-none");
  });

  it("appears once the page has scrolled past the header and stays clickable during scroll", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();

    render(<ActionFab label="Transaction" icon={Plus} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Add Transaction" });

    scrollTo(400);
    expect(button.className).toContain("opacity-100");
    expect((button as HTMLButtonElement).disabled).toBe(false);

    // Unlike mobile, a further scroll must not duck the button out of the way:
    // a mouse wheel is deliberate and there is no thumb covering the content.
    scrollTo(500);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    scrollTo(0);
    expect(button.className).toContain("opacity-0");
  });

  it("opens the shared menu above itself instead of firing the single action", () => {
    const onClick = vi.fn();

    render(
      <ActionFab label="Transaction" icon={Plus} items={menuItems} onClick={onClick} />,
    );
    const button = screen.getByRole("button", { name: "Add Transaction" });
    scrollTo(400);

    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("menu");
    // A floating button has no room below it, so the panel opens upward.
    expect(menu.className).toContain("bottom-full");
    expect(menu.className).not.toContain("top-full");

    fireEvent.click(screen.getByRole("menuitem", { name: /Scan Receipt/ }));
    expect(menuItems[1].onClick).toHaveBeenCalledTimes(1);
  });

  it("closes an open menu when scrolling back to the top hides the button", () => {
    render(<ActionFab label="Transaction" icon={Plus} items={menuItems} onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Add Transaction" });

    scrollTo(400);
    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeTruthy();

    // Otherwise the panel is left floating over the page with nothing under it.
    scrollTo(0);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not reopen the menu after the viewport crosses below sm and back", () => {
    vi.useFakeTimers();
    render(<ActionFab label="Transaction" icon={Plus} items={menuItems} onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Add Transaction" });

    scrollTo(400);
    // Settle the mobile scroll debounce first. Crossing the breakpoint mid-scroll
    // would hide the button and close the menu that way, which is a different
    // path and would pass whether or not the breakpoint itself closes it.
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    // Below `sm` the panel unmounts, but the page is at rest, so the button is
    // not hidden and nothing else would clear the open state.
    crossBreakpoint(false);
    expect(screen.queryByRole("menu")).toBeNull();

    // Rotating back must not bring it up again with no one having asked.
    crossBreakpoint(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("puts the menu after the trigger, so a forward Tab reaches its actions", () => {
    render(<ActionFab label="Transaction" icon={Plus} items={menuItems} onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Add Transaction" });

    scrollTo(400);
    fireEvent.click(button);

    // Tab order follows the DOM, and the panel is positioned absolutely, so
    // rendering it before the trigger sent the next Tab into the page instead.
    const menu = screen.getByRole("menu");
    expect(button.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("dismisses the menu on Escape", () => {
    render(<ActionFab label="Transaction" icon={Plus} items={menuItems} onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Add Transaction" });

    scrollTo(400);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ActionFab offsets", () => {
  const offsetsFor = (install: boolean, installHeight: number, billHeight: number) => {
    overlayMocks.install.bannerVisible = install;
    overlayMocks.install.bannerHeight = installHeight;
    overlayMocks.bills.bannerHeight = billHeight;
    const { unmount } = render(<ActionFab label="Transaction" icon={Plus} onClick={() => {}} />);
    const container = screen.getByRole("button", { name: "Add Transaction" })
      .parentElement as HTMLElement;
    const offsets = {
      base: container.style.getPropertyValue("--fab-bottom"),
      desktop: container.style.getPropertyValue("--fab-bottom-lg"),
    };
    unmount();
    return offsets;
  };

  it("stacks above bill and install banners instead of overlapping them", () => {
    const resting = offsetsFor(false, 0, 0);
    const raised = offsetsFor(true, 100, 80);
    // Banner state has to reach both rendered offsets; the exact geometry is
    // covered in bottom-overlay-clearance.test.ts.
    expect(raised.base).not.toBe(resting.base);
    expect(raised.desktop).not.toBe(resting.desktop);
  });

  it("composes both offsets from the shared clearance helpers", () => {
    const banners = {
      billBannerHeight: 80,
      installBannerVisible: true,
      installBannerHeight: 100,
    };
    const rendered = offsetsFor(true, 100, 80);

    // jsdom's CSSOM rewrites `max()` on round-trip, so compare the expected
    // offset after the same serializer rather than against the raw string.
    const probe = document.createElement("div");
    probe.style.setProperty("--probe", getFabBottom(banners));
    expect(rendered.base).toBe(probe.style.getPropertyValue("--probe"));

    probe.style.setProperty("--probe", getFabBottomDesktop(banners));
    expect(rendered.desktop).toBe(probe.style.getPropertyValue("--probe"));
    // The two differ: above lg there is no bottom nav left to clear.
    expect(rendered.desktop).not.toBe(rendered.base);
  });
});
