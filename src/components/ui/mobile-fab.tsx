"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { useInstallBanner } from "@/components/pwa/install-banner-context";
import { useBillReminders } from "@/components/bills/bill-reminder-provider";

const BASE_OFFSET_REM = 5;
const BILL_BANNER_GAP_PX = 12;
const INSTALL_BANNER_BASE_REM = 4.5;
const INSTALL_BANNER_GAP_PX = 12;

interface MobileFabProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Render as an icon-only button when horizontal screen space is scarce. */
  compact?: boolean;
  /** Temporarily hide the overlay during page scroll so rows beneath remain readable. */
  hideWhileScrolling?: boolean;
}

export function MobileFab({
  label,
  icon: Icon,
  onClick,
  compact = false,
  hideWhileScrolling = false,
}: MobileFabProps) {
  const { bannerVisible, bannerHeight: installBannerHeight } = useInstallBanner();
  const { bannerHeight: billBannerHeight } = useBillReminders();
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!hideWhileScrolling) return;

    const handleScroll = () => {
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
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [hideWhileScrolling]);

  const billClearance = billBannerHeight > 0 ? billBannerHeight + BILL_BANNER_GAP_PX : 0;
  const baseRem = BASE_OFFSET_REM;
  const bannerClearance = bannerVisible
    ? `max(0px, calc(${installBannerHeight + INSTALL_BANNER_GAP_PX}px - ${baseRem - INSTALL_BANNER_BASE_REM}rem))`
    : "0px";

  return (
    <button
      onClick={onClick}
      aria-label={`Add ${label}`}
      style={{ bottom: `calc(${baseRem}rem + ${billClearance}px + ${bannerClearance} + env(safe-area-inset-bottom))` }}
      className={`sm:hidden fixed right-4 z-40 inline-flex items-center justify-center rounded-full bg-amber hover:bg-amber-dark text-white font-medium text-sm shadow-soft-lg active:scale-95 transition-all duration-300 ${
        compact ? "p-3" : "gap-1.5 px-4 py-3"
      } ${isScrolling ? "translate-y-3 opacity-0 pointer-events-none" : "opacity-100"}`}
    >
      <Icon className="w-4 h-4" />
      {!compact && label}
    </button>
  );
}
