"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DatePresets } from "@/components/analytics/date-presets";
import {
  monthRange,
  weekRange,
  weeksInMonth,
  yearRange,
  type PeriodType,
} from "@/lib/analytics-period";

interface TimeRangePickerProps {
  periodType: PeriodType;
  from: string;
  to: string;
  label: string;
  tz: number;
  onPeriodSelect: (type: PeriodType, from: string, to: string) => void;
  onNavigate: (direction: "prev" | "next") => void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TABS: { value: PeriodType; label: string }[] = [
  { value: "custom", label: "Custom range" },
  { value: "weekly", label: "Weeks" },
  { value: "monthly", label: "Months" },
  { value: "yearly", label: "Years" },
];

export function TimeRangePicker({
  periodType,
  from,
  to,
  label,
  tz,
  onPeriodSelect,
  onNavigate,
}: TimeRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PeriodType>(periodType);
  const [displayYear, setDisplayYear] = useState(() => {
    const [y] = from.split("-").map(Number);
    return y;
  });
  const [displayMonth, setDisplayMonth] = useState(() => {
    const [, m] = from.split("-").map(Number);
    return m - 1; // 0-indexed
  });
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const ref = useRef<HTMLDivElement>(null);

  // Sync display year/month and custom inputs when period changes externally
  useEffect(() => {
    const [y, m] = from.split("-").map(Number);
    setDisplayYear(y);
    setDisplayMonth(m - 1);
    setCustomFrom(from);
    setCustomTo(to);
  }, [from, to]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectRange = (type: PeriodType, range: { from: string; to: string }) => {
    onPeriodSelect(type, range.from, range.to);
    setOpen(false);
  };

  const applyCustomRange = () => {
    if (customFrom && customTo) {
      const [validFrom, validTo] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
      onPeriodSelect("custom", validFrom, validTo);
      setOpen(false);
    }
  };

  const currentYear = new Date().getFullYear();

  return (
    <div ref={ref} className="relative">
      {/* Header bar: < label > */}
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => onNavigate("prev")}
          className="p-2 rounded-lg hover:bg-cream-100 text-warm-400 hover:text-warm-600 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <button
          onClick={() => { setOpen(!open); setActiveTab(periodType); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-cream-200 bg-white hover:bg-cream-50 transition-colors min-w-[180px] justify-center"
        >
          <span className="text-sm font-medium text-warm-700">{label}</span>
          <ChevronsUpDown className="w-3.5 h-3.5 text-warm-400" />
        </button>

        <button
          onClick={() => onNavigate("next")}
          className="p-2 rounded-lg hover:bg-cream-100 text-warm-400 hover:text-warm-600 transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[340px] max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-cream-200 z-50 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-cream-100 p-1.5 gap-0.5">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  "flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-all",
                  activeTab === tab.value
                    ? "bg-amber-600 text-white"
                    : "text-warm-500 hover:bg-cream-50"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Quick presets (visible on every tab) */}
          <DatePresets
            tz={tz}
            onSelect={(presetFrom, presetTo) => {
              onPeriodSelect("custom", presetFrom, presetTo);
              setOpen(false);
            }}
          />

          <div className="p-3">
            {/* Months tab */}
            {activeTab === "monthly" && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => setDisplayYear((y) => y - 1)}
                    className="p-1 rounded hover:bg-cream-100 text-warm-400"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-semibold text-warm-700">{displayYear}</span>
                  <button
                    onClick={() => setDisplayYear((y) => y + 1)}
                    className="p-1 rounded hover:bg-cream-100 text-warm-400"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {MONTHS.map((m, i) => {
                    const isSelected =
                      periodType === "monthly" &&
                      displayYear === parseInt(from.split("-")[0]) &&
                      i === parseInt(from.split("-")[1]) - 1;
                    return (
                      <button
                        key={m}
                        onClick={() => selectRange("monthly", monthRange(displayYear, i))}
                        className={cn(
                          "py-2.5 rounded-lg text-sm font-medium transition-all",
                          isSelected
                            ? "bg-amber-600 text-white"
                            : "text-warm-600 hover:bg-cream-100"
                        )}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Weeks tab */}
            {activeTab === "weekly" && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => {
                      if (displayMonth === 0) { setDisplayMonth(11); setDisplayYear((y) => y - 1); }
                      else setDisplayMonth((m) => m - 1);
                    }}
                    className="p-1 rounded hover:bg-cream-100 text-warm-400"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-semibold text-warm-700">
                    {MONTHS[displayMonth]} {displayYear}
                  </span>
                  <button
                    onClick={() => {
                      if (displayMonth === 11) { setDisplayMonth(0); setDisplayYear((y) => y + 1); }
                      else setDisplayMonth((m) => m + 1);
                    }}
                    className="p-1 rounded hover:bg-cream-100 text-warm-400"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-1">
                  {weeksInMonth(displayYear, displayMonth).map((week) => {
                    const isSelected = periodType === "weekly" && from === week.from;
                    return (
                      <button
                        key={week.from}
                        onClick={() => selectRange("weekly", week)}
                        className={cn(
                          "w-full py-2.5 px-3 rounded-lg text-sm font-medium transition-all text-left",
                          isSelected
                            ? "bg-amber-600 text-white"
                            : "text-warm-600 hover:bg-cream-100"
                        )}
                      >
                        {week.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Years tab */}
            {activeTab === "yearly" && (
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 9 }, (_, i) => currentYear - 4 + i).map((year) => {
                  const isSelected = periodType === "yearly" && parseInt(from.split("-")[0]) === year;
                  return (
                    <button
                      key={year}
                      onClick={() => selectRange("yearly", yearRange(year))}
                      className={cn(
                        "py-2.5 rounded-lg text-sm font-medium transition-all",
                        isSelected
                          ? "bg-amber-600 text-white"
                          : "text-warm-600 hover:bg-cream-100"
                      )}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Custom range tab */}
            {activeTab === "custom" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-xs text-warm-400 font-medium">From</label>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="w-full min-w-0 appearance-none px-3 py-2 rounded-lg border border-cream-200 bg-white text-sm text-warm-600 focus:outline-none focus:ring-2 focus:ring-amber-200 [&::-webkit-calendar-picker-indicator]:opacity-60"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-warm-400 font-medium">To</label>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="w-full min-w-0 appearance-none px-3 py-2 rounded-lg border border-cream-200 bg-white text-sm text-warm-600 focus:outline-none focus:ring-2 focus:ring-amber-200 [&::-webkit-calendar-picker-indicator]:opacity-60"
                  />
                </div>
                <button
                  onClick={applyCustomRange}
                  className="w-full py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
