/**
 * Geometry for the stack of fixed elements pinned to the bottom of the mobile
 * viewport: the bill reminder, the install prompt, and the FAB above them.
 *
 * Each one sits at its own resting offset, or rides above whatever is showing
 * beneath it -- whichever is higher. Expressing that as `max()` over the stops
 * keeps every offset measured from the same origin (the viewport bottom), so
 * an element cannot lose distance to a neighbour that rests on a different
 * base. `env(safe-area-inset-bottom)` is added by each consumer, since it
 * applies once to the whole stack rather than per gap.
 */

/** Where the bill reminder rests when nothing is below it. */
export const BILL_BANNER_BASE_REM = 5;
/** Where the install prompt rests when nothing is below it. */
export const INSTALL_BANNER_BASE_REM = 4.5;
/** The same two, above `lg`, where there is no bottom nav to clear. */
export const BILL_BANNER_BASE_DESKTOP_REM = 2;
export const INSTALL_BANNER_BASE_DESKTOP_REM = 1.5;
/** Where the FAB rests when no banner is showing. */
export const FAB_BASE_OFFSET_REM = 5;
/** The FAB's minimum tap target (`min-h-11`). */
export const FAB_MIN_HEIGHT_REM = 2.75;
/** Bottom padding the nested content wrapper (`p-4`) already contributes. */
const CONTENT_PADDING_REM = 1;
/** Space kept between any two stacked overlays. */
const STACK_GAP_PX = 12;

interface BannerState {
  billBannerHeight: number;
  installBannerVisible: boolean;
  installBannerHeight: number;
}

/** Top edge of the bill reminder, or null when it isn't showing. */
function billBannerTop(billBannerHeight: number, baseRem: number) {
  if (billBannerHeight <= 0) return null;
  return `calc(${baseRem}rem + ${billBannerHeight}px)`;
}

/** `max()` over the stops, or the single stop when there is only one. */
function highest(stops: string[]) {
  return stops.length === 1 ? stops[0] : `max(${stops.join(", ")})`;
}

function installBannerBottom(billBannerHeight: number, billBase: number, installBase: number) {
  const stops = [`${installBase}rem`];
  const billTop = billBannerTop(billBannerHeight, billBase);
  if (billTop) stops.push(`calc(${billTop} + ${STACK_GAP_PX}px)`);
  return highest(stops);
}

/**
 * Where the install prompt rests: its own base, or clear of the bill reminder
 * when one is showing.
 */
export function getInstallBannerBottom(billBannerHeight: number) {
  return installBannerBottom(billBannerHeight, BILL_BANNER_BASE_REM, INSTALL_BANNER_BASE_REM);
}

/** The same, above `lg`, where both banners rest closer to the viewport edge. */
export function getInstallBannerBottomDesktop(billBannerHeight: number) {
  return installBannerBottom(
    billBannerHeight,
    BILL_BANNER_BASE_DESKTOP_REM,
    INSTALL_BANNER_BASE_DESKTOP_REM,
  );
}

/**
 * Where the FAB rests: its own base, or clear of whichever banners are
 * showing. Both are listed as stops rather than summed, because the install
 * prompt may already be riding above the bill reminder.
 */
export function getMobileFabBottom({
  billBannerHeight,
  installBannerVisible,
  installBannerHeight,
}: BannerState) {
  const stops = [`${FAB_BASE_OFFSET_REM}rem`];
  const billTop = billBannerTop(billBannerHeight, BILL_BANNER_BASE_REM);
  if (billTop) stops.push(`calc(${billTop} + ${STACK_GAP_PX}px)`);
  if (installBannerVisible) {
    const installTop = `calc(${getInstallBannerBottom(billBannerHeight)} + ${installBannerHeight}px)`;
    stops.push(`calc(${installTop} + ${STACK_GAP_PX}px)`);
  }
  return highest(stops);
}

/**
 * Space `<main>` reserves below its content so the last row clears the FAB:
 * the button's own offset and height, less the padding the nested wrapper
 * already supplies.
 */
export function getMobileFabContentClearance(banners: BannerState) {
  const reserved = FAB_MIN_HEIGHT_REM - CONTENT_PADDING_REM;
  return `calc(${getMobileFabBottom(banners)} + ${reserved}rem)`;
}
