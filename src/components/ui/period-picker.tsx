"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useDismissOnOutside } from "@/components/ui/dropdown-button";
import { MONTH_NAMES } from "@/lib/analytics-buckets";
import {
  ALL_TIME_LABEL,
  DATE_PRESETS,
  formatPeriodLabel,
  getCurrentMonth,
  monthRange,
  navigatePeriod,
  weeksInMonth,
  yearRange,
  type PeriodSelection,
  type PeriodType,
} from "@/lib/analytics-period";
import { cn } from "@/lib/utils";

/**
 * The period control shared by the ledger and analytics.
 *
 * Two presentations, one panel. `"dialog"` renders `Modal` through a portal to
 * the body, and inherits its focus trap, Escape handling and iOS `visualViewport`
 * positioning. `"popover"` anchors to the trigger, and may only be used where no
 * ancestor clips or transforms — it is `absolute`, so a container with
 * `overflow-hidden` cuts it off.
 *
 * Every control is at least 44px on its shortest side, per the rule in AGENTS.md.
 */

const TABS: { value: Exclude<PeriodType, "all">; label: string }[] = [
  { value: "custom", label: "Custom" },
  { value: "weekly", label: "Weeks" },
  { value: "monthly", label: "Months" },
  { value: "yearly", label: "Years" },
];

const YEARS_SHOWN = 9;

const selectedClasses = "border-amber bg-amber-light/35 text-amber-dark";
const unselectedClasses =
  "border-cream-200 text-warm-500 hover:border-cream-300 hover:bg-cream-50 hover:text-warm-700";

/** A grid or list option inside the panel body. */
function OptionButton({
  selected,
  onClick,
  className,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "min-h-11 rounded-xl border px-2 text-sm font-medium transition-colors",
        selected ? selectedClasses : unselectedClasses,
        className,
      )}
    >
      {children}
    </button>
  );
}

/** The year (or month) stepper that sits above a grid. */
function Stepper({
  label,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-cream-50 p-1">
      <button
        type="button"
        onClick={onPrev}
        aria-label={prevLabel}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="font-serif text-xl text-warm-700">{label}</span>
      <button
        type="button"
        onClick={onNext}
        aria-label={nextLabel}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

interface PanelProps {
  value: PeriodSelection;
  tz: number;
  allowAllTime: boolean;
  onSelect: (next: PeriodSelection) => void;
}

/** Tabs, quick ranges, the active grid, and the All time / This month footer. */
export function PeriodPickerPanel({ value, tz, allowAllTime, onSelect }: PanelProps) {
  const anchor = value.from || getCurrentMonth(tz).from;
  const [activeTab, setActiveTab] = useState<Exclude<PeriodType, "all">>(
    value.periodType === "all" ? "monthly" : value.periodType,
  );
  const [displayYear, setDisplayYear] = useState(() => Number(anchor.slice(0, 4)));
  const [displayMonth, setDisplayMonth] = useState(() => Number(anchor.slice(5, 7)) - 1);
  const [customFrom, setCustomFrom] = useState(value.from);
  const [customTo, setCustomTo] = useState(value.to);

  const choose = (periodType: PeriodType, range: { from: string; to: string }) =>
    onSelect({ periodType, ...range });

  const stepMonth = (delta: number) => {
    const stepped = new Date(Date.UTC(displayYear, displayMonth + delta, 1));
    setDisplayYear(stepped.getUTCFullYear());
    setDisplayMonth(stepped.getUTCMonth());
  };

  const applyCustom = () => {
    if (!customFrom || !customTo) return;
    // Accept a range entered backwards rather than rejecting the user's input.
    const [from, to] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
    choose("custom", { from, to });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl bg-cream-100 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveTab(tab.value)}
            aria-pressed={activeTab === tab.value}
            className={cn(
              "min-h-11 flex-1 rounded-lg px-1 text-xs font-semibold transition-colors",
              activeTab === tab.value
                ? "bg-white text-warm-700 shadow-warm"
                : "text-warm-400 hover:text-warm-600",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {DATE_PRESETS.map((preset) => (
          <OptionButton
            key={preset.id}
            selected={false}
            onClick={() => choose("custom", preset.getRange(tz))}
            className="text-xs"
          >
            {preset.label}
          </OptionButton>
        ))}
      </div>

      {activeTab === "monthly" && (
        <div className="space-y-3">
          <Stepper
            label={String(displayYear)}
            onPrev={() => setDisplayYear((year) => year - 1)}
            onNext={() => setDisplayYear((year) => year + 1)}
            prevLabel="Previous year"
            nextLabel="Next year"
          />
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {MONTH_NAMES.map((month, index) => {
              const range = monthRange(displayYear, index);
              return (
                <OptionButton
                  key={month}
                  selected={value.periodType === "monthly" && value.from === range.from}
                  onClick={() => choose("monthly", range)}
                >
                  {month}
                </OptionButton>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "weekly" && (
        <div className="space-y-3">
          <Stepper
            label={`${MONTH_NAMES[displayMonth]} ${displayYear}`}
            onPrev={() => stepMonth(-1)}
            onNext={() => stepMonth(1)}
            prevLabel="Previous month"
            nextLabel="Next month"
          />
          <div className="space-y-1.5">
            {weeksInMonth(displayYear, displayMonth).map((week) => (
              <OptionButton
                key={week.from}
                selected={value.periodType === "weekly" && value.from === week.from}
                // Only the two bounds: a spread WeekOption would carry its label
                // into the selection, and on into query keys and the API payload.
                onClick={() => choose("weekly", { from: week.from, to: week.to })}
                className="w-full text-left"
              >
                {week.label}
              </OptionButton>
            ))}
          </div>
        </div>
      )}

      {activeTab === "yearly" && (
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: YEARS_SHOWN }, (_, index) => {
            const year = Number(getCurrentMonth(tz).from.slice(0, 4)) - 4 + index;
            const range = yearRange(year);
            return (
              <OptionButton
                key={year}
                selected={value.periodType === "yearly" && value.from === range.from}
                onClick={() => choose("yearly", range)}
              >
                {year}
              </OptionButton>
            );
          })}
        </div>
      )}

      {activeTab === "custom" && (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-warm-400">From</span>
            <input
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="min-h-11 w-full min-w-0 appearance-none rounded-xl border border-cream-200 bg-white px-3 text-sm text-warm-600 outline-none focus:border-amber focus:ring-2 focus:ring-amber/20"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-warm-400">To</span>
            <input
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
              className="min-h-11 w-full min-w-0 appearance-none rounded-xl border border-cream-200 bg-white px-3 text-sm text-warm-600 outline-none focus:border-amber focus:ring-2 focus:ring-amber/20"
            />
          </label>
          <button
            type="button"
            onClick={applyCustom}
            disabled={!customFrom || !customTo}
            className="min-h-11 w-full rounded-xl bg-amber px-3 text-sm font-semibold text-white transition-colors hover:bg-amber-dark disabled:opacity-40"
          >
            Apply range
          </button>
        </div>
      )}

      <div className="flex gap-2 border-t border-cream-200 pt-4">
        {allowAllTime && (
          <button
            type="button"
            onClick={() => onSelect({ periodType: "all", from: "", to: "" })}
            aria-pressed={value.periodType === "all"}
            className={cn(
              "min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold transition-colors",
              value.periodType === "all" ? selectedClasses : unselectedClasses,
            )}
          >
            {ALL_TIME_LABEL}
          </button>
        )}
        <button
          type="button"
          onClick={() => choose("monthly", getCurrentMonth(tz))}
          className="min-h-11 flex-1 rounded-xl bg-amber px-3 text-sm font-semibold text-white transition-colors hover:bg-amber-dark"
        >
          This month
        </button>
      </div>
    </div>
  );
}

export interface PeriodPickerProps {
  value: PeriodSelection;
  onChange: (next: PeriodSelection) => void;
  /** The user's saved offset, `getTimezoneOffset()` convention (UTC+8 is -480). */
  tz: number;
  /** Overrides the derived label — analytics prefers the one its own API returns. */
  label?: string;
  /** Analytics cannot offer All time: its API requires a bounded window. */
  allowAllTime?: boolean;
  presentation?: "popover" | "dialog";
  className?: string;
}

export function PeriodPicker({
  value,
  onChange,
  tz,
  label,
  allowAllTime = false,
  presentation = "dialog",
  className,
}: PeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resolvedLabel = label ?? formatPeriodLabel(value.periodType, value.from, value.to);

  // createPortal needs a document, so the dialog cannot render on the server.
  // It is always closed on first paint, so nothing is missing before this runs.
  useEffect(() => setMounted(true), []);

  // The popover has no Modal to restore focus for it, so a keyboard user who
  // closes it does not get dropped back at the top of the document.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  useDismissOnOutside(open && presentation === "popover", () => setOpen(false), containerRef);

  const select = (next: PeriodSelection) => {
    onChange(next);
    setOpen(false);
  };

  // Navigation lives here rather than in each page: navigatePeriod also reports the
  // resulting period type, and a caller that dropped it would leave All time stuck.
  const navigate = (direction: "prev" | "next") =>
    onChange(navigatePeriod(value.periodType, value.from, value.to, direction, tz));

  const panel = (
    <PeriodPickerPanel value={value} tz={tz} allowAllTime={allowAllTime} onSelect={select} />
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="flex items-center justify-between rounded-xl border border-cream-200 bg-cream-50/60 p-0.5">
        <button
          type="button"
          onClick={() => navigate("prev")}
          aria-label="Previous period"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={`Choose period, currently ${resolvedLabel}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="relative flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-warm-600 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/20 sm:min-w-32"
        >
          <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-warm-400" />
          <span className="min-w-0 select-none truncate text-center">{resolvedLabel}</span>
        </button>
        <button
          type="button"
          onClick={() => navigate("next")}
          aria-label="Next period"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-warm-400 transition-colors hover:bg-white hover:text-warm-700"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {presentation === "dialog" ? (
        // Portalled to the body, and that is load-bearing rather than tidiness.
        // The transactions toolbar carries a transform even at rest — Tailwind's
        // `translate-y-0` emits an identity matrix — and any transform makes an
        // element the containing block for `position: fixed` descendants. Left in
        // place, Modal's full-viewport overlay resolves against the toolbar
        // instead and its `overflow-hidden` clips the dialog out of sight.
        mounted &&
        createPortal(
          <Modal open={open} onClose={() => setOpen(false)} title="Choose period">
            {panel}
          </Modal>,
          document.body,
        )
      ) : (
        open && (
          <div className="absolute left-1/2 top-full z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-cream-200 bg-white p-3 shadow-lg">
            {panel}
          </div>
        )
      )}
    </div>
  );
}
