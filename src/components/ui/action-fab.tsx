"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { useInstallBanner } from "@/components/pwa/install-banner-context";
import { useBillReminders } from "@/components/bills/bill-reminder-provider";
import {
  getFabBottom,
  getFabBottomDesktop,
} from "@/components/ui/bottom-overlay-clearance";
import {
  DropdownMenu,
  useDismissOnOutside,
  type DropdownItem,
} from "@/components/ui/dropdown-button";

/**
 * How far the page must scroll before the FAB appears at `sm` and above. It is
 * a distance rather than an observation of the real header button, which would
 * mean threading a ref out of all five pages that render one; it only has to
 * clear a page title and its subtitle.
 */
const REVEAL_SCROLL_PX = 180;
/** Where the reveal behaviour switches. Mirrors the header button's `sm:` gate. */
const DESKTOP_QUERY = "(min-width: 640px)";

interface ActionFabProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /**
   * Extra actions offered from the FAB above `sm`. Below it the prop is
   * ignored and the button stays a single action, since the mobile tab bar
   * already carries scan and a menu would duplicate it.
   */
  items?: DropdownItem[];
  /** Opt out of the icon-only shape and render the label beside the icon. */
  compact?: boolean;
  /** Opt out of hiding the overlay during page scroll. Mobile only. */
  hideWhileScrolling?: boolean;
  /** Hide the create action while another page-level interaction owns the context. */
  suppressed?: boolean;
}

/**
 * The floating create button, shown at every width.
 *
 * Two breakpoints are in play and they deliberately differ. *Visibility*
 * switches at `sm`: below it the button rests in place and ducks out of the
 * way while the page scrolls, and above it the header button is on screen at
 * the top, so the FAB stays hidden until the page has scrolled past it.
 * *Geometry* switches at `lg`, which is where `MobileTabBar` stops occupying
 * the bottom of the viewport -- a tablet reveals on scroll but still has a nav
 * to clear.
 *
 * Visibility needs JS ("scrolled past" is not a media query), so it is state.
 * The offset is CSS, set as custom properties the `lg:` variant switches
 * between, the same way both bottom banners do it.
 */
export function ActionFab({
  label,
  icon: Icon,
  onClick,
  items,
  compact = true,
  hideWhileScrolling = true,
  suppressed = false,
}: ActionFabProps) {
  const { bannerVisible, bannerHeight: installBannerHeight } = useInstallBanner();
  const { bannerHeight: billBannerHeight } = useBillReminders();
  // `null` until the mount effect resolves it: the server and the first client
  // render then agree, and desktop never flashes a button at the top of the
  // page only to fade it back out.
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [scrolledPast, setScrolledPast] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useDismissOnOutside(menuOpen, () => setMenuOpen(false), containerRef);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setIsDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!hideWhileScrolling) setIsScrolling(false);
    // Read the position once on mount, so a page restored mid-scroll shows the
    // button without waiting for the reader to move first.
    setScrolledPast(window.scrollY > REVEAL_SCROLL_PX);

    const handleScroll = () => {
      setScrolledPast(window.scrollY > REVEAL_SCROLL_PX);

      if (!hideWhileScrolling) return;
      setIsScrolling(true);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = undefined;
        setIsScrolling(false);
      }, 180);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = undefined;
      }
    };
  }, [hideWhileScrolling]);

  const hidden =
    suppressed ||
    (isDesktop === null ? true : isDesktop ? !scrolledPast : hideWhileScrolling && isScrolling);

  const hasMenu = isDesktop === true && !!items?.length;

  // A menu left open while the button fades out floats on its own, so scrolling
  // back to the top closes it. Losing the menu entirely has to close it too:
  // dropping below `sm` only unmounts the panel, so a window narrowed past the
  // breakpoint and widened again -- or a phone rotated to portrait and back --
  // would otherwise bring it back open with no one having asked for it.
  useEffect(() => {
    if (hidden || !hasMenu) setMenuOpen(false);
  }, [hidden, hasMenu]);

  const restingBottom = getFabBottom({
    billBannerHeight,
    installBannerVisible: bannerVisible,
    installBannerHeight,
  });
  const restingBottomDesktop = getFabBottomDesktop({
    billBannerHeight,
    installBannerVisible: bannerVisible,
    installBannerHeight,
  });

  // `disabled` flips the instant a scroll starts, so the fade out is kept
  // short: a slow one leaves the button looking perfectly tappable for the
  // length of the transition while it silently ignores taps. Coming back is
  // unhurried, where there is no such mismatch to hide. While the breakpoint
  // is still unresolved there is no transition at all -- the button has never
  // been seen, so there is nothing to fade.
  return (
    <div
      ref={containerRef}
      style={
        {
          "--fab-bottom": restingBottom,
          "--fab-bottom-lg": restingBottomDesktop,
        } as CSSProperties
      }
      className={`fixed right-4 lg:right-8 z-40 bottom-[calc(var(--fab-bottom)+env(safe-area-inset-bottom))] lg:bottom-[calc(var(--fab-bottom-lg)+env(safe-area-inset-bottom))] ${
        hidden ? "pointer-events-none" : "pointer-events-auto"
      }`}
    >
      <button
        onClick={() => (hasMenu ? setMenuOpen((prev) => !prev) : onClick())}
        disabled={hidden}
        aria-label={`Add ${label}`}
        aria-haspopup={hasMenu ? "menu" : undefined}
        aria-expanded={hasMenu ? menuOpen : undefined}
        className={`min-h-11 inline-flex items-center justify-center rounded-full bg-amber hover:bg-amber-dark text-white font-medium text-sm shadow-soft-lg active:scale-95 ${
          compact ? "min-w-11 p-3" : "gap-1.5 px-4 py-3"
        } ${
          isDesktop === null
            ? "transition-none translate-y-3 opacity-0"
            : hidden
              ? "transition-all duration-100 translate-y-3 opacity-0"
              : "transition-all duration-300 opacity-100"
        }`}
      >
        <Icon className="w-4 h-4" />
        {!compact && label}
      </button>
      {/* After the trigger, not before it: the panel is absolutely positioned,
          so DOM order costs nothing visually, but it is what a forward Tab
          follows. Rendered first, opening the menu from the keyboard sent the
          next Tab past it into the page. */}
      {hasMenu && items && (
        <DropdownMenu
          open={menuOpen}
          items={items}
          onSelect={() => setMenuOpen(false)}
          placement="top"
        />
      )}
    </div>
  );
}
