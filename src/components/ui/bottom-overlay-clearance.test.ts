import { describe, expect, it } from "vitest";
import {
  INSTALL_BANNER_BASE_REM,
  MOBILE_FAB_STATIC_CLEARANCE_REM,
  getBillBannerClearancePx,
  getMobileFabBannerClearance,
} from "@/components/ui/bottom-overlay-clearance";

describe("getMobileFabBannerClearance", () => {
  it("adds no dynamic clearance when both banners are hidden", () => {
    expect(getMobileFabBannerClearance({
      billBannerHeight: 0,
      installBannerVisible: false,
      installBannerHeight: 0,
    })).toBe("calc(0px + 0px)");
  });

  it("adds the bill height and gap when the bill banner is visible", () => {
    expect(getMobileFabBannerClearance({
      billBannerHeight: 88,
      installBannerVisible: false,
      installBannerHeight: 0,
    })).toBe("calc(100px + 0px)");
  });

  it("adds the install height relative to its lower base offset", () => {
    expect(getMobileFabBannerClearance({
      billBannerHeight: 0,
      installBannerVisible: true,
      installBannerHeight: 120,
    })).toBe("calc(0px + max(0px, calc(132px - 0.5rem)))");
  });

  it("stacks both banner clearances", () => {
    expect(getMobileFabBannerClearance({
      billBannerHeight: 88,
      installBannerVisible: true,
      installBannerHeight: 120,
    })).toBe("calc(100px + max(0px, calc(132px - 0.5rem)))");
  });
});

describe("getBillBannerClearancePx", () => {
  it("adds nothing when no bill reminder is showing", () => {
    expect(getBillBannerClearancePx(0)).toBe(0);
  });

  it("adds the reminder's height plus the gap when one is showing", () => {
    expect(getBillBannerClearancePx(88)).toBe(100);
  });
});

describe("shared offsets", () => {
  it("still resolve to the values the layout shipped with", () => {
    // 5rem offset + 2.75rem tap target - 1rem from the nested `p-4` wrapper.
    expect(MOBILE_FAB_STATIC_CLEARANCE_REM).toBe(6.75);
    // The install banner renders this as its own resting offset; the FAB
    // subtracts it from FAB_BASE_OFFSET_REM to sit above the banner.
    expect(INSTALL_BANNER_BASE_REM).toBe(4.5);
  });
});
