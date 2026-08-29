"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, BarChart3, LayoutDashboard, ScanLine } from "lucide-react";
import { motion } from "framer-motion";
import { ProfileMenu } from "@/components/profile-menu";
import { cn } from "@/lib/utils";

const MOBILE_TABS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

const MORE_DESTINATIONS = ["/profile", "/bills", "/categories", "/labels", "/admin"];
const TOP_SCROLL_BOUNDARY = 32;
const SCROLL_TRANSITION_DISTANCE = 8;

interface MobileTabBarProps {
  pathname: string;
  name: string;
  email: string;
  isAdmin: boolean;
  scanEnabled: boolean;
  scanLimitReached: boolean;
  hasScanLimit: boolean;
  scansRemaining: number | null;
  onScan: () => void;
}

interface CompactScrollState {
  compact: boolean;
  anchorScrollY: number;
}

export const isMobileTabActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export const getNextCompactScrollState = (
  state: CompactScrollState,
  currentScrollY: number
): CompactScrollState => {
  if (currentScrollY < TOP_SCROLL_BOUNDARY) {
    return { compact: false, anchorScrollY: currentScrollY };
  }

  const distance = currentScrollY - state.anchorScrollY;
  if (Math.abs(distance) <= SCROLL_TRANSITION_DISTANCE) return state;

  return { compact: distance > 0, anchorScrollY: currentScrollY };
};

function useCompactOnScroll(pathname: string) {
  const [compact, setCompact] = useState(false);
  const scrollState = useRef<CompactScrollState>({ compact: false, anchorScrollY: 0 });

  useEffect(() => {
    const anchorScrollY = Math.max(window.scrollY, 0);
    scrollState.current = { compact: false, anchorScrollY };
    setCompact(false);
  }, [pathname]);

  useEffect(() => {
    let frame: number | null = null;

    const update = () => {
      const currentScrollY = Math.max(window.scrollY, 0);
      const nextState = getNextCompactScrollState(scrollState.current, currentScrollY);

      if (nextState.compact !== scrollState.current.compact) setCompact(nextState.compact);
      scrollState.current = nextState;
      frame = null;
    };

    const handleScroll = () => {
      if (frame === null) frame = window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  return compact;
}

function ActiveTabSelection() {
  return (
    <motion.span
      layoutId="mobile-tab-selection"
      aria-hidden="true"
      className="absolute inset-0 rounded-[1.25rem] bg-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_5px_rgba(44,36,23,0.06)]"
      transition={{ type: "spring", duration: 0.42, bounce: 0.16 }}
    />
  );
}

function MobileTabItem({
  item,
  pathname,
  compact,
}: {
  item: (typeof MOBILE_TABS)[number];
  pathname: string;
  compact: boolean;
}) {
  const isActive = isMobileTabActive(pathname, item.href);

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "relative flex min-w-0 flex-1 flex-col items-center justify-center rounded-[1.25rem] px-1",
        "transition-[color,min-height] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-1",
        "motion-reduce:transition-none",
        compact ? "min-h-11" : "min-h-[52px]",
        isActive ? "text-amber-dark" : "text-warm-400 hover:text-warm-600"
      )}
    >
      {isActive && <ActiveTabSelection />}
      <item.icon
        aria-hidden="true"
        className={cn(
          "relative z-10 h-[21px] w-[21px] shrink-0 transition-transform duration-200 motion-reduce:transition-none",
          isActive && "scale-105 stroke-[2.25]"
        )}
      />
      <span
        className={cn(
          "relative z-10 overflow-hidden truncate text-center text-[11px] font-medium leading-none",
          "transition-[max-height,margin,opacity] duration-200 motion-reduce:transition-none",
          compact ? "mt-0 max-h-0 opacity-0" : "mt-1 max-h-4 opacity-100"
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}

function ScanAction({
  compact,
  scanLimitReached,
  hasScanLimit,
  scansRemaining,
  onScan,
}: Pick<
  MobileTabBarProps,
  "scanLimitReached" | "hasScanLimit" | "scansRemaining" | "onScan"
> & { compact: boolean }) {
  const label = scanLimitReached
    ? "Scan receipt unavailable: monthly limit reached"
    : hasScanLimit && scansRemaining !== null
      ? `Scan receipt, ${scansRemaining} remaining this month`
      : "Scan receipt";

  return (
    <button
      type="button"
      onClick={onScan}
      disabled={scanLimitReached}
      aria-label={label}
      className={cn(
        "liquid-glass-surface pointer-events-auto relative flex shrink-0 items-center justify-center rounded-full",
        "text-amber-dark transition-[width,height,transform,color] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2",
        "enabled:active:scale-95 motion-reduce:transition-none",
        compact ? "h-[52px] w-[52px]" : "h-16 w-16",
        scanLimitReached && "cursor-not-allowed text-warm-300 opacity-80"
      )}
    >
      <ScanLine aria-hidden="true" className="h-[23px] w-[23px] stroke-[2.15]" />
      {hasScanLimit && scansRemaining !== null && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -right-0.5 -top-0.5 flex min-h-5 min-w-5 items-center justify-center rounded-full px-1",
            "border-2 border-cream-50 text-[10px] font-bold leading-none text-white shadow-sm",
            scanLimitReached ? "bg-expense" : "bg-amber"
          )}
        >
          {scansRemaining}
        </span>
      )}
    </button>
  );
}

export function MobileTabBar(props: MobileTabBarProps) {
  const { pathname, name, email, isAdmin, scanEnabled } = props;
  const compact = useCompactOnScroll(pathname);
  const moreIsActive = MORE_DESTINATIONS.some((href) => isMobileTabActive(pathname, href));

  return (
    <nav
      aria-label="Primary navigation"
      className="liquid-tab-bar pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className="mx-auto flex max-w-[30rem] items-end gap-2">
        <div
          className={cn(
            "liquid-glass-surface pointer-events-auto relative flex min-w-0 flex-1 items-center",
            "rounded-[1.75rem] transition-[padding,border-radius] duration-300 motion-reduce:transition-none",
            compact ? "rounded-[1.6rem] p-1" : "p-1.5"
          )}
        >
          {MOBILE_TABS.map((item) => (
            <MobileTabItem key={item.href} item={item} pathname={pathname} compact={compact} />
          ))}
          <ProfileMenu
            variant="mobile"
            triggerStyle="liquid-tab"
            active={moreIsActive}
            compact={compact}
            name={name}
            email={email}
            isAdmin={isAdmin}
          />
        </div>
        {scanEnabled && <ScanAction compact={compact} {...props} />}
      </div>
    </nav>
  );
}
