const BILL_BANNER_GAP_PX = 12;
const INSTALL_BANNER_GAP_PX = 12;
const FAB_INSTALL_OFFSET_DIFFERENCE_REM = 0.5;

interface MobileFabBannerClearanceOptions {
  billBannerHeight: number;
  installBannerVisible: boolean;
  installBannerHeight: number;
}

/**
 * Mirrors MobileFab's dynamic banner offsets so the end of page content stays
 * below the raised action. The install term remains a CSS calculation because
 * its offset difference is expressed in rem rather than assuming a 16px root.
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
