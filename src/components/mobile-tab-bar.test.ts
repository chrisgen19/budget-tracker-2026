import { describe, expect, it, vi } from "vitest";
import { buildMenuItems } from "./profile-menu";
import { getNextCompactScrollState, isMobileTabActive } from "./mobile-tab-bar";

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
});
