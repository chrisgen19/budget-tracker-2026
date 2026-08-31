"use client";

import { useEffect, useId, useState } from "react";
import { AlertCircle, CalendarDays, ChevronDown, Clock3 } from "lucide-react";
import {
  formatAccountDateInput,
  relativeAccountDateInput,
} from "@/lib/account-time";
import { cn } from "@/lib/utils";

interface TransactionDateTimeFieldProps {
  /**
   * Seed value only: it is read once, at mount. The parent's `date` field has exactly one
   * writer -- this component's own `onChange` -- so there is nothing to sync back from.
   * A syncing effect would be actively wrong: a native date control reports `""` while its
   * segments are being retyped, `update()` writes that through, and re-splitting it would
   * overwrite the half-typed date with today's fallback. If a second writer is ever added
   * (a `reset()`, a quick-pick), remount the field with a `key` rather than syncing it.
   */
  value: string;
  timezoneOffset: number;
  dateWarning?: boolean;
  error?: string;
  /** Bumped by react-hook-form on every submit attempt; reopens the editor to show the error. */
  submitCount?: number;
  onChange: (value: string) => void;
}

const NOT_SET = "Not set";

const splitDateTime = (value: string, timezoneOffset: number) => {
  const fallback = formatAccountDateInput(new Date(), timezoneOffset);
  const date = /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : fallback.slice(0, 10);
  const timeMatch = value.match(/T(\d{2}:\d{2})/);

  return {
    date,
    time: timeMatch?.[1] ?? fallback.slice(11, 16),
  };
};

const isTodayOrYesterday = (date: string, timezoneOffset: number) => {
  const now = new Date();
  return (
    date === formatAccountDateInput(now, timezoneOffset).slice(0, 10) ||
    date === relativeAccountDateInput(now, timezoneOffset, -1).slice(0, 10)
  );
};

/**
 * Names whichever halves are set. Each half is formatted independently so clearing the time
 * does not also hide the date the user just picked, which is the only thing the collapsed
 * summary row shows on mobile.
 */
const formatSummary = (date: string, time: string, timezoneOffset: number) => {
  const dateParts = date.split("-").map(Number);
  const timeParts = time.split(":").map(Number);
  const hasDate = dateParts.length === 3 && !dateParts.some((part) => !Number.isFinite(part));
  const hasTime = timeParts.length === 2 && !timeParts.some((part) => !Number.isFinite(part));
  if (!hasDate && !hasTime) {
    return { short: "Choose date and time", full: "Choose date and time" };
  }

  const [year, month, day] = dateParts;
  const [hour, minute] = timeParts;
  const dateOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  };
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  };

  let shortDate = NOT_SET;
  let fullDate = NOT_SET;
  if (hasDate) {
    // Wall time, so it is formatted back out in the zone it was built in rather than the browser's.
    const wallDate = new Date(Date.UTC(year, month - 1, day));
    const accountYear = Number(formatAccountDateInput(new Date(), timezoneOffset).slice(0, 4));
    shortDate = new Intl.DateTimeFormat(
      "en-US",
      year === accountYear ? dateOptions : { ...dateOptions, year: "numeric" },
    ).format(wallDate);
    fullDate = new Intl.DateTimeFormat("en-US", {
      ...dateOptions,
      month: "long",
      year: "numeric",
    }).format(wallDate);
  }
  const formattedTime = hasTime
    ? new Intl.DateTimeFormat("en-US", timeOptions).format(
        new Date(Date.UTC(1970, 0, 1, hour, minute)),
      )
    : NOT_SET;

  return {
    short: `${shortDate} · ${formattedTime}`,
    full: hasDate && hasTime
      ? `${fullDate} at ${formattedTime}`
      : hasDate
        ? `${fullDate}, time not set`
        : `date not set, ${formattedTime}`,
  };
};

export function TransactionDateTimeField({
  value,
  timezoneOffset,
  dateWarning,
  error,
  submitCount = 0,
  onChange,
}: TransactionDateTimeFieldProps) {
  const fieldId = useId();
  const [{ date, time }, setParts] = useState(() => splitDateTime(value, timezoneOffset));
  const warningVisible = !!dateWarning && !!date && !isTodayOrYesterday(date, timezoneOffset);
  const [expanded, setExpanded] = useState(warningVisible);
  const displayedError = error
    ? !date
      ? "Choose a date."
      : !time
        ? "Choose a time."
        : error
    : undefined;
  const describedBy = [
    warningVisible ? `${fieldId}-warning` : undefined,
    displayedError ? `${fieldId}-error` : undefined,
  ]
    .filter(Boolean)
    .join(" ") || undefined;
  const summary = formatSummary(date, time, timezoneOffset);

  // `submitCount` is a dependency, not just `displayedError`: a user who collapses the editor
  // while an error is already showing would otherwise submit into silence, since the error
  // string is unchanged and the only surface reporting it is inside the collapsed fieldset.
  useEffect(() => {
    if (warningVisible || displayedError) setExpanded(true);
  }, [displayedError, warningVisible, submitCount]);

  const update = (nextDate: string, nextTime: string) => {
    setParts({ date: nextDate, time: nextTime });
    onChange(nextDate && nextTime ? `${nextDate}T${nextTime}` : "");
  };

  return (
    <div>
      <button
        type="button"
        aria-label={`Date and time, ${summary.full}.${displayedError ? ` ${displayedError}` : ""} ${expanded ? "Collapse editor" : "Edit"}`}
        aria-expanded={expanded}
        aria-controls={`${fieldId}-editor`}
        // Not `aria-invalid`: ARIA does not support it on role="button". The error is carried
        // in the label instead, so a collapsed trigger still announces what is wrong.
        aria-describedby={describedBy}
        onClick={() => setExpanded((current) => !current)}
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3.5 py-2 text-left transition-all sm:hidden",
          displayedError
            ? "border-expense bg-expense/5"
            : expanded
              ? "border-amber bg-amber-50/50 ring-2 ring-amber/20"
              : "border-cream-300 bg-cream-50/50 hover:border-cream-400 hover:bg-cream-100/60",
        )}
      >
        <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-warm-400" />
        <span className="shrink-0 text-sm font-semibold text-warm-600">Date &amp; time</span>
        <span
          className={cn(
            "ml-auto min-w-0 truncate text-sm",
            displayedError ? "text-expense" : "text-warm-500",
          )}
        >
          {summary.short}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-warm-400 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      <fieldset
        id={`${fieldId}-editor`}
        className={cn("mt-2.5 sm:mt-0", !expanded && "hidden sm:block")}
      >
          <legend className="sr-only sm:not-sr-only sm:mb-3 sm:block sm:text-sm sm:font-semibold sm:text-warm-600">
            Date &amp; time
          </legend>
          {/*
            Both inputs need `appearance-none`. iOS Safari renders a native date/time control
            that sizes to its intrinsic content and does not honour `w-full`, so without it the
            two fields render wider than the rest of the form and spill out of the grid cell.
            `min-w-0` does not cover this: it governs shrinking below min-content, not the
            width the UA control imposes. Chromium sizes them normally, so this is invisible
            outside a real iOS device. Same pair of classes as `bill-form.tsx`.
          */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="min-w-0">
              <label
                htmlFor={`${fieldId}-date`}
                className="mb-1.5 block text-xs font-medium text-warm-400"
              >
                Date
              </label>
              <div className="relative">
                <CalendarDays
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-warm-400"
                />
                <input
                  id={`${fieldId}-date`}
                  type="date"
                  value={date}
                  aria-required="true"
                  aria-invalid={!!displayedError}
                  aria-describedby={describedBy}
                  onChange={(event) => update(event.target.value, time)}
                  className="min-h-11 w-full min-w-0 appearance-none rounded-xl border border-cream-300 bg-cream-50/50 py-2.5 pl-10 pr-3 text-sm text-warm-700 transition-all focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30 [&::-webkit-calendar-picker-indicator]:opacity-60"
                />
              </div>
            </div>

            <div className="min-w-0">
              <label
                htmlFor={`${fieldId}-time`}
                className="mb-1.5 block text-xs font-medium text-warm-400"
              >
                Time
              </label>
              <div className="relative">
                <Clock3
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-warm-400"
                />
                <input
                  id={`${fieldId}-time`}
                  type="time"
                  step="60"
                  value={time}
                  aria-required="true"
                  aria-invalid={!!displayedError}
                  aria-describedby={describedBy}
                  onChange={(event) => update(date, event.target.value)}
                  className="min-h-11 w-full min-w-0 appearance-none rounded-xl border border-cream-300 bg-cream-50/50 py-2.5 pl-10 pr-3 text-sm text-warm-700 transition-all focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30 [&::-webkit-calendar-picker-indicator]:opacity-60"
                />
              </div>
            </div>
          </div>

          {warningVisible && (
            <div
              id={`${fieldId}-warning`}
              className="mt-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3"
            >
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
              />
              <p className="text-xs text-amber-700">
                The receipt date year looks incorrect (possible POS error). Please verify and
                correct the date.
              </p>
            </div>
          )}

          {displayedError && (
            <p id={`${fieldId}-error`} className="mt-1.5 text-sm text-expense">
              {displayedError}
            </p>
          )}
      </fieldset>
    </div>
  );
}
