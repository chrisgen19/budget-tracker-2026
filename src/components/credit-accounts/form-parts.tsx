"use client";

import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";

export const INPUT_CLASS =
  "w-full px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all";

/** An empty number field means "not set", which the schemas spell `null` rather than 0 or NaN. */
export const optionalNumber = (value: unknown): number | null => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/** A labelled input. The input sits inside the label, so the label names it for assistive tech. */
export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <div>
      <label className="block">
        <span className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-warm-600">
          {label}
          {hint && <span className="text-xs font-normal text-warm-400">{hint}</span>}
        </span>
        {children}
      </label>
      {error && <p className="mt-1 text-sm text-expense">{error}</p>}
    </div>
  );
}

interface FormActionsProps {
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
}

export function FormActions({ onCancel, submitting, submitLabel }: FormActionsProps) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
      >
        <X className="w-4 h-4" />
        Cancel
      </button>
      <button
        type="submit"
        disabled={submitting}
        className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <>
            <Plus className="w-4 h-4" />
            {submitLabel}
          </>
        )}
      </button>
    </div>
  );
}
