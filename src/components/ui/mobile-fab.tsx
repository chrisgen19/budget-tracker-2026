"use client";

import type { LucideIcon } from "lucide-react";
import { useInstallBanner } from "@/components/pwa/install-banner-context";
import { useBillReminders } from "@/components/bills/bill-reminder-provider";

const BASE_OFFSET_REM = 5;
const BILL_REMINDER_STACK_OFFSET_REM = 7;
const INSTALL_BANNER_BASE_REM = 4.5;
const INSTALL_BANNER_GAP_PX = 12;

interface MobileFabProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

export function MobileFab({ label, icon: Icon, onClick }: MobileFabProps) {
  const { bannerVisible, bannerHeight } = useInstallBanner();
  const { pendingReminders } = useBillReminders();

  const billOffset = pendingReminders.length > 0 ? BILL_REMINDER_STACK_OFFSET_REM : 0;
  const baseRem = BASE_OFFSET_REM + billOffset;
  const bannerClearance = bannerVisible
    ? `max(0px, calc(${bannerHeight + INSTALL_BANNER_GAP_PX}px - ${baseRem - INSTALL_BANNER_BASE_REM}rem))`
    : "0px";

  return (
    <button
      onClick={onClick}
      style={{ bottom: `calc(${baseRem}rem + ${bannerClearance} + env(safe-area-inset-bottom))` }}
      className="sm:hidden fixed right-4 z-40 inline-flex items-center gap-1.5 px-4 py-3 rounded-full bg-amber hover:bg-amber-dark text-white font-medium text-sm shadow-soft-lg active:scale-95 transition-all duration-300"
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
