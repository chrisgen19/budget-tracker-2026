import { describe, expect, it, vi } from "vitest";
import { buildMenuItems } from "./profile-menu";
import {
  MOBILE_TABS,
  MORE_DESTINATIONS,
  getNextCompactScrollState,
  isMobileTabActive,
} from "./mobile-tab-bar";
import { NAV_ITEMS } from "./app-shell";

describe("isMobileTabActive", () => {
  it("matches a destination and its nested routes", () => {
    expect(isMobileTabActive("/transactions", "/transactions")).toBe(true);
    expect(isMobileTabActive("/transactions/import", "/transactions")).toBe(true);
  });

  it("does not match a similarly prefixed route", () => {
    expect(isMobileTabActive("/transaction-settings", "/transactions")).toBe(false);
  });
});

describe("getNextCompactScrollState", () => {
  it("accumulates small downward movements before compacting", () => {
    const initial = { compact: false, anchorScrollY: 100 };
    const afterFivePixels = getNextCompactScrollState(initial, 105);
    const afterTenPixels = getNextCompactScrollState(afterFivePixels, 110);

    expect(afterFivePixels).toEqual(initial);
    expect(afterTenPixels).toEqual({ compact: true, anchorScrollY: 110 });
  });

  it("accumulates small upward movements before expanding", () => {
    const initial = { compact: true, anchorScrollY: 110 };
    const afterFivePixels = getNextCompactScrollState(initial, 105);
    const afterTenPixels = getNextCompactScrollState(afterFivePixels, 100);

    expect(afterFivePixels).toEqual(initial);
    expect(afterTenPixels).toEqual({ compact: false, anchorScrollY: 100 });
  });
});

describe("mobile More destinations", () => {
  it("includes a Quick Log action that is hidden from the desktop dropdown", () => {
    // The desktop sidebar already carries Quick Log, so without `mobileOnly` it would appear
    // twice there -- the same reason Bills, Categories and Labels carry it.
    const router = { push: vi.fn() };
    const items = buildMenuItems({
      isAdmin: false,
      hideAmounts: false,
      router: router as unknown as Parameters<typeof buildMenuItems>[0]["router"],
      toggleHideAmounts: () => {},
    });

    const quickLog = items.find((item) => item.key === "quick-log");
    expect(quickLog?.mobileOnly).toBe(true);
    quickLog?.onSelect();
    expect(router.push).toHaveBeenCalledWith("/quick-log");
  });

  it("includes a Labels action", () => {
    const push = vi.fn();
    const items = buildMenuItems({
      isAdmin: false,
      hideAmounts: false,
      router: { push },
      toggleHideAmounts: vi.fn(),
    });
    const labels = items.find((item) => item.key === "labels");

    expect(labels?.mobileOnly).toBe(true);
    labels?.onSelect();
    expect(push).toHaveBeenCalledWith("/labels");
  });

  it("includes a Cards action when credit cards are enabled", () => {
    const push = vi.fn();
    const items = buildMenuItems({
      isAdmin: false,
      hideAmounts: false,
      router: { push },
      toggleHideAmounts: vi.fn(),
      cardsEnabled: true,
    });
    const cards = items.find((item) => item.key === "cards");

    expect(cards?.mobileOnly).toBe(true);
    cards?.onSelect();
    expect(push).toHaveBeenCalledWith("/cards");
  });

  // The /admin/settings switch keeps Cards to admins until it is turned on for everyone.
  it("leaves Cards out when credit cards are not enabled for this user", () => {
    const items = buildMenuItems({
      isAdmin: false,
      hideAmounts: false,
      router: { push: vi.fn() },
      toggleHideAmounts: vi.fn(),
    });

    expect(items.some((item) => item.key === "cards")).toBe(false);
  });
});

/**
 * Below `lg` the sidebar does not exist -- it is `hidden lg:flex` -- so everything reachable on a
 * phone comes from `MOBILE_TABS` or the "More" menu. Those are three hand-kept lists of the same
 * destinations, and they drifted the first time it mattered: `/goals` shipped in the sidebar alone,
 * which left the page not merely buried but unreachable on mobile, and reaching it by URL lit no tab
 * because `MORE_DESTINATIONS` drives the "More" tab's own active state.
 *
 * Asserted against the real exported lists rather than a copy, so a page added to the sidebar and
 * nowhere else fails here instead of shipping.
 */
describe("mobile navigation reachability", () => {
  const destinations = () => {
    const push = vi.fn();
    return buildMenuItems({
      isAdmin: true,
      hideAmounts: false,
      router: { push } as unknown as Parameters<typeof buildMenuItems>[0]["router"],
      toggleHideAmounts: vi.fn(),
      cardsEnabled: true,
    })
      // The two items that act rather than navigate. Invoking them here is not merely pointless:
      // `logout` calls `signOut()`, which fires a real fetch at a relative URL and throws under
      // jsdom, and `privacy` writes a preference. Excluded by key so a new *navigating* item is
      // still picked up automatically.
      .filter((item) => item.key !== "privacy" && item.key !== "logout")
      .map((item) => {
        push.mockClear();
        item.onSelect?.();
        return push.mock.calls[0]?.[0] as string | undefined;
      })
      .filter((href): href is string => typeof href === "string");
  };

  it("reaches every sidebar destination from a phone", () => {
    const reachable = new Set([...MOBILE_TABS.map((t) => t.href), ...destinations()]);
    const unreachable = NAV_ITEMS.map((item) => item.href).filter((href) => !reachable.has(href));
    expect(unreachable, "in the sidebar but reachable from no mobile control").toEqual([]);
  });

  it("lights the More tab on every page that menu can open", () => {
    const missing = destinations().filter((href) => !MORE_DESTINATIONS.includes(href));
    expect(missing, "openable from the More menu but leaves no tab active").toEqual([]);
  });

  it("claims no destination the More menu cannot actually open", () => {
    const opens = new Set(destinations());
    // `/admin` is in the menu only for an admin, and `destinations()` asks as one.
    const stale = MORE_DESTINATIONS.filter((href) => !opens.has(href));
    expect(stale, "listed as a More destination but nothing there navigates to it").toEqual([]);
  });
});
