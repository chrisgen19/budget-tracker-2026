"use client";

import { useId, useState } from "react";
import { AlertCircle, CalendarDays, Clock3 } from "lucide-react";
import {
  formatAccountDateInput,
  relativeAccountDateInput,
} from "@/lib/account-time";

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
  onChange: (value: string) => void;
}

const INPUT_CLASS =
  "min-h-11 w-full min-w-0 appearance-none rounded-xl border border-cream-300 bg-cream-50/50 py-2.5 pl-9 pr-2.5 text-sm text-warm-700 transition-all sm:pl-10 sm:pr-3 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30 [&::-webkit-calendar-picker-indicator]:opacity-60";

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

  const update = (nextDate: string, nextTime: string) => {
    setParts({ date: nextDate, time: nextTime });
    onChange(nextDate && nextTime ? `${nextDate}T${nextTime}` : "");
  };

  // No collapsed summary in front of the inputs, at any width. It cost a tap before either
  // native picker could open, and a button cannot stand in for that tap: iOS Safari has no
  // `HTMLInputElement.showPicker()`, so the picker only opens when the input itself is touched.
  return (
    <fieldset>
      <legend className="mb-2 block text-sm font-semibold text-warm-600 sm:mb-3">
        Date &amp; time
      </legend>
      {/*
        Both inputs need `appearance-none`. iOS Safari renders a native date/time control
        that sizes to its intrinsic content and does not honour `w-full`, so without it the
        two fields render wider than the rest of the form and spill out of the grid cell.
        `min-w-0` does not cover this: it governs shrinking below min-content, not the
        width the UA control imposes. Chromium sizes them normally, so this is invisible
        outside a real iOS device, which is how the rewrite that dropped it shipped.
        Every `type="date"` / `type="time"` input in the app needs the pair -- see also
        `bill-form.tsx`, `label-form.tsx` and `time-range-picker.tsx`.

        The per-input labels are visually hidden below `sm`, where the legend and the two icons
        already say which is which and a second row of text would only push the form down.
      */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="min-w-0">
          <label
            htmlFor={`${fieldId}-date`}
            className="sr-only sm:not-sr-only sm:mb-1.5 sm:block sm:text-xs sm:font-medium sm:text-warm-400"
          >
            Date
          </label>
          <div className="relative">
            <CalendarDays
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-warm-400 sm:left-3"
            />
            <input
              id={`${fieldId}-date`}
              type="date"
              value={date}
              aria-required="true"
              aria-invalid={!!displayedError}
              aria-describedby={describedBy}
              onChange={(event) => update(event.target.value, time)}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="min-w-0">
          <label
            htmlFor={`${fieldId}-time`}
            className="sr-only sm:not-sr-only sm:mb-1.5 sm:block sm:text-xs sm:font-medium sm:text-warm-400"
          >
            Time
          </label>
          <div className="relative">
            <Clock3
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-warm-400 sm:left-3"
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
              className={INPUT_CLASS}
            />
          </div>
        </div>
      </div>

      {warningVisible && (
        <div
          id={`${fieldId}-warning`}
          className="mt-2.5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-700">
            The receipt date year looks incorrect (possible POS error). Please verify and correct
            the date.
          </p>
        </div>
      )}

      {displayedError && (
        <p id={`${fieldId}-error`} className="mt-1.5 text-sm text-expense">
          {displayedError}
        </p>
      )}
    </fieldset>
  );
}
