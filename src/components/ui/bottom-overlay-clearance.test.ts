import { describe, expect, it } from "vitest";
import {
  BILL_BANNER_BASE_DESKTOP_REM,
  BILL_BANNER_BASE_REM,
  FAB_BASE_OFFSET_DESKTOP_REM,
  FAB_BASE_OFFSET_REM,
  INSTALL_BANNER_BASE_REM,
  getFabBottom,
  getFabBottomDesktop,
  getFabContentClearance,
  getFabContentClearanceDesktop,
  getInstallBannerBottom,
  getInstallBannerBottomDesktop,
} from "@/components/ui/bottom-overlay-clearance";

/**
 * The offsets are CSS expressions, so resolve them the way a browser would to
 * assert on distances rather than on string shape. Only `rem`, `px`, `calc()`
 * and `max()` appear here, which is little enough to evaluate directly.
 */
const ROOT_FONT_PX = 16;
const resolve = (css: string): number => {
  const inner = css.trim();
  // Sum at the top level first: a `max(...)` with a trailing `+ 12px` is an
  // addition, not a function call, and stripping it as one corrupts the tail.
  const terms = splitTopLevel(inner, "+");
  if (terms.length > 1) return terms.reduce((sum, term) => sum + resolve(term), 0);
  const wraps = (fn: string) => inner.startsWith(`${fn}(`) && inner.endsWith(")");
  if (wraps("max")) return Math.max(...splitTopLevel(inner.slice(4, -1)).map(resolve));
  if (wraps("calc")) return resolve(inner.slice(5, -1));
  if (inner.endsWith("rem")) return parseFloat(inner) * ROOT_FONT_PX;
  if (inner.endsWith("px")) return parseFloat(inner);
  throw new Error(`unhandled length: ${inner}`);
};

const splitTopLevel = (input: string, separator = ",") => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
};

const BILL_H = 180;
const INSTALL_H = 126;
const GAP = 12;

describe("getInstallBannerBottom", () => {
  it("rests at its own base when no bill reminder is showing", () => {
    expect(resolve(getInstallBannerBottom(0))).toBe(INSTALL_BANNER_BASE_REM * ROOT_FONT_PX);
  });

  it("clears the bill reminder by the stack gap, not less", () => {
    const billTop = BILL_BANNER_BASE_REM * ROOT_FONT_PX + BILL_H;
    // Regression: the clearance used to be added to the install banner's own
    // lower base, so the 8px difference between the two bases ate most of the
    // gap and the banners sat 4px apart.
    expect(resolve(getInstallBannerBottom(BILL_H)) - billTop).toBe(GAP);
  });
});

describe("getInstallBannerBottomDesktop", () => {
  it("clears the bill reminder by the stack gap above lg too", () => {
    const billTop = 2 * ROOT_FONT_PX + BILL_H;
    expect(resolve(getInstallBannerBottomDesktop(BILL_H)) - billTop).toBe(GAP);
  });
});

const bannerCases = [
  { name: "no banners", billBannerHeight: 0, installBannerVisible: false, installBannerHeight: 0 },
  { name: "bill only", billBannerHeight: BILL_H, installBannerVisible: false, installBannerHeight: 0 },
  { name: "install only", billBannerHeight: 0, installBannerVisible: true, installBannerHeight: INSTALL_H },
  { name: "both", billBannerHeight: BILL_H, installBannerVisible: true, installBannerHeight: INSTALL_H },
];

/**
 * The two variants differ only in which set of base offsets they stack over,
 * so they get the same assertions. Above `lg` there is no bottom nav under the
 * stack, which is the whole reason the desktop bases are lower.
 */
const variants = [
  {
    name: "below lg",
    fabBottom: getFabBottom,
    clearance: getFabContentClearance,
    installBottom: getInstallBannerBottom,
    fabBase: FAB_BASE_OFFSET_REM,
    billBase: BILL_BANNER_BASE_REM,
  },
  {
    name: "above lg",
    fabBottom: getFabBottomDesktop,
    clearance: getFabContentClearanceDesktop,
    installBottom: getInstallBannerBottomDesktop,
    fabBase: FAB_BASE_OFFSET_DESKTOP_REM,
    billBase: BILL_BANNER_BASE_DESKTOP_REM,
  },
];

describe.each(variants)("getFabBottom ($name)", (variant) => {
  it("rests at its own base when no banner is showing", () => {
    expect(resolve(variant.fabBottom(bannerCases[0]))).toBe(variant.fabBase * ROOT_FONT_PX);
  });

  it.each(bannerCases)("clears every visible banner by the stack gap ($name)", (banners) => {
    const fabBottom = resolve(variant.fabBottom(banners));
    if (banners.billBannerHeight > 0) {
      const billTop = variant.billBase * ROOT_FONT_PX + banners.billBannerHeight;
      expect(fabBottom).toBeGreaterThanOrEqual(billTop + GAP);
    }
    if (banners.installBannerVisible) {
      const installTop =
        resolve(variant.installBottom(banners.billBannerHeight)) + banners.installBannerHeight;
      // Regression: with both banners up, the FAB compensated for the install
      // banner's lower base a second time and sat 8px too low.
      expect(fabBottom).toBe(installTop + GAP);
    }
    expect(fabBottom).toBeGreaterThanOrEqual(variant.fabBase * ROOT_FONT_PX);
  });
});

describe("getFabBottomDesktop", () => {
  it.each(bannerCases)("rests lower than below lg, where no bottom nav is left to clear ($name)", (banners) => {
    expect(resolve(getFabBottomDesktop(banners))).toBeLessThan(resolve(getFabBottom(banners)));
  });
});

describe.each(variants)("getFabContentClearance ($name)", (variant) => {
  it.each([0, BILL_H])("ends content flush with the FAB's top edge (bill %ipx)", (billHeight) => {
    const banners = {
      billBannerHeight: billHeight,
      installBannerVisible: true,
      installBannerHeight: INSTALL_H,
    };
    const FAB_HEIGHT = 44;
    const NESTED_PADDING = 16; // the `p-4` wrapper inside <main>
    const fabTop = resolve(variant.fabBottom(banners)) + FAB_HEIGHT;
    expect(resolve(variant.clearance(banners)) + NESTED_PADDING).toBe(fabTop);
  });
});
