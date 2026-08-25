"use client";

import { useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Lease durations offered in the UI. `null` is "until I turn it off", which the API still caps
 *  at 30 days so a forgotten lease closes itself eventually. */
const LEASE_OPTIONS: { label: string; minutes: number }[] = [
  { label: "1 hour", minutes: 60 },
  { label: "8 hours", minutes: 8 * 60 },
  { label: "30 days", minutes: 30 * 24 * 60 },
];

interface McpWriteAccessProps {
  /** ISO instant the lease lapses, or null when writes are off. */
  enabledUntil: string | null;
  onChange: (minutes: number | null) => Promise<void>;
}

const formatUntil = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function McpWriteAccess({ enabledUntil, onChange }: McpWriteAccessProps) {
  const [saving, setSaving] = useState(false);

  // Recomputed on render rather than stored: a lease that lapses while the page sits open should
  // read as off without needing a refresh or a timer.
  const live = enabledUntil !== null && new Date(enabledUntil) > new Date();

  const apply = async (minutes: number | null) => {
    setSaving(true);
    try {
      await onChange(minutes);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={cn(
        "p-4 rounded-xl border",
        live ? "border-amber bg-amber-light/30" : "border-cream-300 bg-cream-50/50"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
            live ? "bg-amber" : "bg-cream-200"
          )}
        >
          {live ? (
            <Unlock className="w-5 h-5 text-white" />
          ) : (
            <Lock className="w-5 h-5 text-warm-400" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-warm-600">Write access</p>
          <p className="text-xs text-warm-400 mt-0.5">
            {live
              ? `Claude can create transactions until ${formatUntil(enabledUntil!)}.`
              : "Claude can read your budget but cannot create transactions."}
          </p>
          <p className="text-xs text-warm-400 mt-1">
            A token still needs the{" "}
            <code className="font-mono">transactions:write</code> scope as well. This switch turns
            writing off for every token at once.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {LEASE_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={saving}
            onClick={() => apply(option.minutes)}
            className="px-3 py-1.5 rounded-full text-xs font-medium border border-cream-300 text-warm-500 hover:bg-cream-100 transition-colors disabled:opacity-50"
          >
            {live ? `Extend ${option.label}` : `Enable ${option.label}`}
          </button>
        ))}
        {live && (
          <button
            type="button"
            disabled={saving}
            onClick={() => apply(null)}
            className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
          >
            Turn off now
          </button>
        )}
      </div>
    </div>
  );
}
