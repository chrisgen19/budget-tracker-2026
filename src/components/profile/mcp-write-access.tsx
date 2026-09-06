"use client";

import { useEffect, useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";

/** Lease durations offered in the UI. `null` is "until I turn it off", which the API still caps
 *  at 30 days so a forgotten lease closes itself eventually. */
/** Longest delay `setTimeout` represents faithfully; anything larger is truncated and fires
 *  immediately. */
const MAX_TIMEOUT_MS = 2_147_483_647;

const LEASE_OPTIONS: { label: string; minutes: number }[] = [
  { label: "1 hour", minutes: 60 },
  { label: "8 hours", minutes: 8 * 60 },
  { label: "30 days", minutes: 30 * 24 * 60 },
];

interface McpWriteAccessProps {
  /** ISO instant the lease lapses, `null` when writes are off, `undefined` when unknown. */
  enabledUntil: string | null | undefined;
  onChange: (minutes: number | null) => Promise<void>;
  onReload: () => void;
}

const formatUntil = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function McpWriteAccess({ enabledUntil, onChange, onReload }: McpWriteAccessProps) {
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const unknown = enabledUntil === undefined;
  const expiresAt = enabledUntil ? new Date(enabledUntil).getTime() : null;
  const live = expiresAt !== null && expiresAt > now;

  // Wall-clock time passing does not itself re-render, so without this the panel would keep
  // saying Claude can write for as long as the page stays open, while the server had already
  // begun refusing.
  //
  // Re-armed in bounded hops rather than one long timer: `setTimeout` truncates a delay above
  // 2^31-1 ms (about 24.8 days), so the 30-day lease would fire immediately and, with `expiresAt`
  // unchanged, never schedule again. Each hop moves `now`, which re-runs this effect.
  useEffect(() => {
    if (expiresAt === null || expiresAt <= now) return;
    const delay = Math.min(expiresAt - now + 1000, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [expiresAt, now]);

  const apply = async (minutes: number | null) => {
    setSaving(true);
    try {
      await onChange(minutes);
      setNow(Date.now());
    } finally {
      setSaving(false);
    }
  };

  // Never claim writes are off when the state could not be read: an active lease would then be
  // invisible and the "Turn off now" action absent, which is the opposite of what the panel is
  // for. Say so and offer a retry instead.
  if (unknown) {
    return (
      <div className="p-4 rounded-xl border border-dashed border-cream-300 text-center">
        <p className="text-sm text-warm-400">Could not read write access state.</p>
        <button
          type="button"
          onClick={onReload}
          className="mt-2 text-xs font-medium text-amber-dark hover:text-amber underline"
        >
          Try again
        </button>
      </div>
    );
  }

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
              ? `Claude can add and change transactions until ${formatUntil(enabledUntil!)}.`
              : "Claude can read your budget but cannot add or change transactions."}
          </p>
          <p className="text-xs text-warm-400 mt-1">
            Each option replaces the current expiry rather than adding to it. A token still needs
            the <code className="font-mono">transactions:write</code> scope as well, which covers
            both adding and changing transactions. This switch turns writing off for every token at
            once.
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
            {live ? `Set to ${option.label}` : `Enable ${option.label}`}
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
