"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Gauge,
  Sparkles,
  Trophy,
  WalletCards,
  CalendarDays,
  CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalyticsTab } from "@/lib/analytics-url";

const ANALYTICS_TABS = [
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
    id: "forecast" as const,
    label: "Forecast",
    shortLabel: "Forecast",
    icon: CalendarDays,
  },
  {
    id: "debt" as const,
    label: "Debt",
    shortLabel: "Debt",
    icon: CreditCard,
    /** Hidden entirely for a user the credit cards switch excludes. */
    requiresCards: true,
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

const FADE_PX = 24;

type Edges = { start: boolean; end: boolean };

/** A mask that fades whichever edge still has tabs beyond it, so the cut reads as "more". */
const edgeMask = ({ start, end }: Edges): string | undefined => {
  if (!start && !end) return undefined;
  const left = start ? `transparent 0, #000 ${FADE_PX}px` : "#000 0";
  const right = end
    ? `#000 calc(100% - ${FADE_PX}px), transparent 100%`
    : "#000 100%";
  return `linear-gradient(to right, ${left}, ${right})`;
};

/** Scrolls a row horizontally. jsdom has no `Element.scrollTo`, so it falls back to `scrollLeft`. */
const scrollRowTo = (el: HTMLElement, left: number, smooth: boolean) => {
  if (typeof el.scrollTo === "function") {
    el.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  } else {
    el.scrollLeft = left;
  }
};

/**
 * Tracks whether a horizontal scroller has content past either edge.
 *
 * `onShown` fires when the scroller goes from zero width to a real one. The sticky
 * copy of the bar sits in a `hidden` row until the page scrolls, and a scroll
 * position set while it measured zero is lost, so it re-centres the active tab then.
 * jsdom has no `ResizeObserver`, so that half is guarded.
 */
const useScrollEdges = (
  ref: RefObject<HTMLDivElement | null>,
  onShown: () => void,
): Edges => {
  const onShownRef = useRef(onShown);
  // Assigned in the commit rather than during render, so a render React throws away
  // cannot leave a closure over its own `activeTab` behind for the observer to call.
  useLayoutEffect(() => {
    onShownRef.current = onShown;
  });
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((prev) =>
        prev.start === start && prev.end === end ? prev : { start, end },
      );
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => el.removeEventListener("scroll", measure);
    }
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (lastWidth === 0 && el.clientWidth > 0) onShownRef.current();
      lastWidth = el.clientWidth;
      measure();
    });
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [ref]);

  return edges;
};

const KEY_STEPS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

/** Arrow button shown on wider screens while tabs sit past that edge. Mouse only: keyboard users have the arrow keys. */
function ScrollNudge({
  side,
  visible,
  onClick,
}: {
  side: "start" | "end";
  visible: boolean;
  onClick: () => void;
}) {
  const Icon = side === "start" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={onClick}
      className={cn(
        // 32px visual, 44px hit area via the pseudo-element (the touch-target rule in AGENTS.md).
        "absolute top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-cream-300 bg-white text-warm-500 shadow-sm transition-colors hover:text-warm-700",
        "before:absolute before:-inset-1.5 before:content-['']",
        side === "start" ? "-left-1.5" : "-right-1.5",
        visible && "sm:flex",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/**
 * Tab switcher: one row at every width, scrolling sideways when the tabs do not fit.
 * It was a three-column grid below `sm`, which wrapped eight tabs into three rows,
 * and an unbounded flex row above it, which ran past the content width on tablets.
 *
 * `layoutId` must be unique per rendered instance — the in-page and sticky copies
 * are mounted at once, and a shared id would make the active pill animate across
 * the two bars.
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
  showCards = false,
}: {
  activeTab: AnalyticsTab;
  onSelect: (tab: AnalyticsTab) => void;
  layoutId: string;
  className?: string;
  /** Whether this user may see the cards half. A tab that 403s is worse than no tab. */
  showCards?: boolean;
}) {
  const tabs = ANALYTICS_TABS.filter((tab) => showCards || !tab.requiresCards);
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
  // The page turns an excluded user's `?tab=debt` into Reports, but the bar should not rely
  // on that: with the active tab filtered out, nothing would carry tabIndex 0 and the whole
  // row would drop out of the Tab order. The first tab stands in as the way in.
  const focusableId = activeIndex >= 0 ? activeTab : tabs[0].id;
  const reduceMotion = useReducedMotion();
  const rowRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<AnalyticsTab, HTMLButtonElement>());
  const hasCentred = useRef(false);

  const centreActive = useCallback(
    (smooth: boolean) => {
      const el = rowRef.current;
      const btn = tabRefs.current.get(activeTab);
      if (!el || !btn || el.clientWidth === 0) return;
      scrollRowTo(el, btn.offsetLeft - (el.clientWidth - btn.offsetWidth) / 2, smooth);
    },
    [activeTab],
  );
  const edges = useScrollEdges(rowRef, () => centreActive(false));

  // Jump straight to the active tab on first paint (a deep link to ?tab=ai-assessment),
  // then glide on later changes unless the user asked for less motion.
  useEffect(() => {
    centreActive(hasCentred.current && !reduceMotion);
    hasCentred.current = true;
  }, [centreActive, reduceMotion]);

  const nudge = (direction: 1 | -1) => {
    const el = rowRef.current;
    if (!el) return;
    scrollRowTo(el, el.scrollLeft + direction * el.clientWidth * 0.7, !reduceMotion);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEPS[e.key];
    if (!step) return;
    e.preventDefault();
    // From an active tab that is not in the row, any arrow lands on the stand-in rather
    // than stepping from a position that does not exist.
    const next = activeIndex < 0 ? tabs[0] : tabs[step(activeIndex, tabs.length)];
    onSelect(next.id);
    tabRefs.current.get(next.id)?.focus({ preventScroll: true });
  };

  const mask = edgeMask(edges);

  return (
    <div
      className={cn(
        "relative w-full min-w-0 max-w-full p-1 bg-cream-200 rounded-xl sm:w-fit",
        className,
      )}
    >
      <ScrollNudge side="start" visible={edges.start} onClick={() => nudge(-1)} />
      <div
        ref={rowRef}
        role="tablist"
        aria-label="Analytics sections"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        className="relative flex gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.id, node);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={tab.id === focusableId ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              className={cn(
                // min-h-11 is the 44px touch target, same as the type filter's buttons
                // (#212, and 397da22 for that control). The height comes from the minimum,
                // not the padding, so the compact `sm:py-1.5` look is unchanged on a pointer
                // device. shrink-0 + nowrap keep each tab whole: the row scrolls instead.
                "relative flex shrink-0 items-center justify-center gap-1 sm:gap-1.5 min-h-11 px-3 py-2.5 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-colors",
                // The row is a scroll container, which clips an outside outline, so the ring is
                // inset. It sits on ::after because the active tab's white pill would cover a ring
                // drawn on the button itself.
                "focus-visible:outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-amber/50",
                isActive ? "text-warm-700" : "text-warm-400 hover:text-warm-500",
              )}
            >
              {isActive && (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0 bg-white rounded-lg shadow-sm"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
              <tab.icon className="relative w-4 h-4 shrink-0" />
              <span className="relative">
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </span>
            </button>
          );
        })}
      </div>
      <ScrollNudge side="end" visible={edges.end} onClick={() => nudge(1)} />
    </div>
  );
}
