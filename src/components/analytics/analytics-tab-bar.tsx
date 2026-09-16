"use client";

import { motion } from "framer-motion";
import {
  BarChart3,
  ClipboardCheck,
  Gauge,
  Sparkles,
  Trophy,
  WalletCards,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalyticsTab } from "@/lib/analytics-url";

export const ANALYTICS_TABS = [
  {
    id: "reports" as const,
    label: "Reports",
    shortLabel: "Reports",
    icon: BarChart3,
  },
  {
    id: "budget" as const,
    label: "Budget Performance",
    shortLabel: "Budget",
    icon: WalletCards,
  },
  {
    id: "watchlist" as const,
    label: "Watchlist",
    shortLabel: "Watch",
    icon: ClipboardCheck,
  },
  {
    id: "statistics" as const,
    label: "Records & Statistics",
    shortLabel: "Stats",
    icon: Trophy,
  },
  {
    id: "health" as const,
    label: "Cash Flow Signals",
    shortLabel: "Signals",
    icon: Gauge,
  },
  {
    id: "ai-assessment" as const,
    label: "AI Assessment",
    shortLabel: "AI",
    icon: Sparkles,
  },
];

/**
 * Tab switcher. `layoutId` must be unique per rendered instance — the in-page and
 * sticky copies are mounted at once, and a shared id would make the active pill
 * animate across the two bars.
 *
 * This lives outside `analytics/page.tsx` because a page module may only export
 * the fields Next.js recognises. Exporting the component from there to make it
 * testable compiled clean under `tsc --noEmit` and failed `next build` with
 * `"AnalyticsTabBar" is not a valid Page export field`.
 */
export function AnalyticsTabBar({
  activeTab,
  onSelect,
  layoutId,
  className,
}: {
  activeTab: AnalyticsTab;
  onSelect: (tab: AnalyticsTab) => void;
  layoutId: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "grid grid-cols-3 w-full gap-1 p-1 bg-cream-100 rounded-xl sm:flex sm:w-fit",
        className,
      )}
    >
      {ANALYTICS_TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onSelect(tab.id)}
          className={cn(
            // min-h-11 is the 44px touch target, same as the type filter's buttons
            // (#212, and 397da22 for that control). Without it these are 36px on
            // mobile and 32px from `sm:` up, where the padding shrinks faster than
            // the text grows. The height comes from the minimum, not the padding,
            // so the compact `sm:py-1.5` look is unchanged on a pointer device.
            "relative flex items-center justify-center gap-1 sm:gap-1.5 min-h-11 min-w-0 px-2 sm:px-3 py-2.5 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors",
            activeTab === tab.id
              ? "text-warm-700"
              : "text-warm-400 hover:text-warm-500",
          )}
        >
          {activeTab === tab.id && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 bg-white rounded-lg shadow-sm"
              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
            />
          )}
          <tab.icon className="relative w-4 h-4 shrink-0" />
          <span className="relative truncate">
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.shortLabel}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
