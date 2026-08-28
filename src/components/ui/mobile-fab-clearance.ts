/** Distance from the viewport bottom to the resting FAB. */
export const FAB_BASE_OFFSET_REM = 5;
/** The FAB's minimum tap target (`min-h-11`). */
export const FAB_MIN_HEIGHT_REM = 2.75;
/** Bottom padding the nested content wrapper (`p-4`) already contributes. */
const CONTENT_PADDING_REM = 1;
/** The install banner measures its own offset from a lower base than the FAB. */
const INSTALL_BANNER_BASE_REM = 4.5;
const FAB_INSTALL_OFFSET_DIFFERENCE_REM = FAB_BASE_OFFSET_REM - INSTALL_BANNER_BASE_REM;
const BILL_BANNER_GAP_PX = 12;
const INSTALL_BANNER_GAP_PX = 12;

/**
 * Fixed space `<main>` reserves below its content for the resting FAB: the
 * button's own offset and height, less the padding the nested wrapper supplies.
 */
export const MOBILE_FAB_STATIC_CLEARANCE_REM =
  FAB_BASE_OFFSET_REM + FAB_MIN_HEIGHT_REM - CONTENT_PADDING_REM;

interface MobileFabBannerClearanceOptions {
  billBannerHeight: number;
  installBannerVisible: boolean;
  installBannerHeight: number;
}

/**
 * Distance the FAB rises above its resting offset to clear the fixed banners.
 * `MobileFab` adds it to {@link FAB_BASE_OFFSET_REM} for its own `bottom`, and
 * `<main>` adds the same value to its padding, so page content ends below the
 * raised button. The install term stays a CSS calculation because its offset
 * difference is expressed in rem rather than assuming a 16px root.
 */
export function getMobileFabBannerClearance({
  billBannerHeight,
  installBannerVisible,
  installBannerHeight,
}: MobileFabBannerClearanceOptions) {
  const billClearance = billBannerHeight > 0
    ? billBannerHeight + BILL_BANNER_GAP_PX
    : 0;
  const installClearance = installBannerVisible
    ? `max(0px, calc(${installBannerHeight + INSTALL_BANNER_GAP_PX}px - ${FAB_INSTALL_OFFSET_DIFFERENCE_REM}rem))`
    : "0px";

  return `calc(${billClearance}px + ${installClearance})`;
}
