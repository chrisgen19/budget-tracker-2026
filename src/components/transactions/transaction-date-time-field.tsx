"use client";

import { useEffect, useId, useState } from "react";
import { AlertCircle, CalendarDays, ChevronDown, Clock3 } from "lucide-react";
import {
  formatAccountDateInput,
  relativeAccountDateInput,
} from "@/lib/account-time";
import { cn } from "@/lib/utils";

interface TransactionDateTimeFieldProps {
  value: string;
  timezoneOffset: number;
  dateWarning?: boolean;
  error?: string;
  onChange: (value: string) => void;
}

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

const formatSummary = (date: string, time: string, timezoneOffset: number) => {
  const dateParts = date.split("-").map(Number);
  const timeParts = time.split(":").map(Number);
  if (
    dateParts.length !== 3 ||
    timeParts.length !== 2 ||
    dateParts.some((part) => !Number.isFinite(part)) ||
    timeParts.some((part) => !Number.isFinite(part))
  ) {
    return { short: "Choose date and time", full: "Choose date and time" };
  }

  const [year, month, day] = dateParts;
  const [hour, minute] = timeParts;
  const wallTime = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const accountYear = Number(formatAccountDateInput(new Date(), timezoneOffset).slice(0, 4));
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
  const shortDate = new Intl.DateTimeFormat(
    "en-US",
    year === accountYear ? dateOptions : { ...dateOptions, year: "numeric" },
  ).format(wallTime);
  const fullDate = new Intl.DateTimeFormat("en-US", {
    ...dateOptions,
    month: "long",
    year: "numeric",
  }).format(wallTime);
  const formattedTime = new Intl.DateTimeFormat("en-US", timeOptions).format(wallTime);

  return {
    short: `${shortDate} · ${formattedTime}`,
    full: `${fullDate} at ${formattedTime}`,
  };
};

export function TransactionDateTimeField({
  value,
  timezoneOffset,
  dateWarning,
  error,
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

  useEffect(() => {
    if (warningVisible || displayedError) setExpanded(true);
  }, [displayedError, warningVisible]);

  const update = (nextDate: string, nextTime: string) => {
    setParts({ date: nextDate, time: nextTime });
    onChange(nextDate && nextTime ? `${nextDate}T${nextTime}` : "");
  };

  return (
    <div>
      <button
        type="button"
        aria-label={`Date and time, ${summary.full}. ${expanded ? "Collapse editor" : "Edit"}`}
        aria-expanded={expanded}
        aria-controls={`${fieldId}-editor`}
        onClick={() => setExpanded((current) => !current)}
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3.5 py-2 text-left transition-all sm:hidden",
          expanded
            ? "border-amber bg-amber-50/50 ring-2 ring-amber/20"
            : "border-cream-300 bg-cream-50/50 hover:border-cream-400 hover:bg-cream-100/60",
        )}
      >
        <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-warm-400" />
        <span className="shrink-0 text-sm font-semibold text-warm-600">Date &amp; time</span>
        <span className="ml-auto min-w-0 truncate text-sm text-warm-500">{summary.short}</span>
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
                  className="min-h-11 w-full min-w-0 rounded-xl border border-cream-300 bg-cream-50/50 py-2.5 pl-10 pr-3 text-sm text-warm-700 transition-all focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30"
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
                  className="min-h-11 w-full min-w-0 rounded-xl border border-cream-300 bg-cream-50/50 py-2.5 pl-10 pr-3 text-sm text-warm-700 transition-all focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30"
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
