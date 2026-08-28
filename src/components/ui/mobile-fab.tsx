"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { useInstallBanner } from "@/components/pwa/install-banner-context";
import { useBillReminders } from "@/components/bills/bill-reminder-provider";
import {
  FAB_BASE_OFFSET_REM,
  getMobileFabBannerClearance,
} from "@/components/ui/mobile-fab-clearance";

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
    if (!hideWhileScrolling) {
      setIsScrolling(false);
      return;
    }

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
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = undefined;
      }
    };
  }, [hideWhileScrolling]);

  const hiddenForScroll = hideWhileScrolling && isScrolling;

  const bannerClearance = getMobileFabBannerClearance({
    billBannerHeight,
    installBannerVisible: bannerVisible,
    installBannerHeight,
  });

  return (
    <button
      onClick={onClick}
      disabled={hiddenForScroll}
      aria-label={`Add ${label}`}
      style={{ bottom: `calc(${FAB_BASE_OFFSET_REM}rem + ${bannerClearance} + env(safe-area-inset-bottom))` }}
      className={`sm:hidden fixed right-4 z-40 min-h-11 inline-flex items-center justify-center rounded-full bg-amber hover:bg-amber-dark text-white font-medium text-sm shadow-soft-lg active:scale-95 transition-all duration-300 ${
        compact ? "min-w-11 p-3" : "gap-1.5 px-4 py-3"
      } ${hiddenForScroll ? "translate-y-3 opacity-0" : "opacity-100"}`}
    >
      <Icon className="w-4 h-4" />
      {!compact && label}
    </button>
  );
}
