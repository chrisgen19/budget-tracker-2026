"use client";

import { useEffect, useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { isForeverLease, MCP_WRITE_LEASE_FOREVER } from "@/lib/validations";

/** Longest delay `setTimeout` represents faithfully; anything larger is truncated and fires
 *  immediately. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Extends a pill's 30px height to a 44px touch target without making the row taller. */
const HIT_AREA =
  "relative before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']";

/** Minutes from now, `"forever"` until switched off by hand, `null` to switch writes off. */
export type McpWriteLease = number | typeof MCP_WRITE_LEASE_FOREVER | null;

/** Lease durations offered in the UI. "Forever" stays open until "Turn off now"; every other
 *  option lapses on its own. */
const LEASE_OPTIONS: { label: string; lease: Exclude<McpWriteLease, null> }[] = [
  { label: "1 hour", lease: 60 },
  { label: "8 hours", lease: 8 * 60 },
  { label: "30 days", lease: 30 * 24 * 60 },
  { label: "90 days", lease: 90 * 24 * 60 },
  { label: "1 year", lease: 365 * 24 * 60 },
  { label: "forever", lease: MCP_WRITE_LEASE_FOREVER },
];

interface McpWriteAccessProps {
  /** ISO instant the lease lapses, `null` when writes are off, `undefined` when unknown. */
  enabledUntil: string | null | undefined;
  onChange: (lease: McpWriteLease) => Promise<void>;
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

  const apply = async (lease: McpWriteLease) => {
    setSaving(true);
    try {
      await onChange(lease);
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
            {!live
              ? "Claude can read your budget but cannot add or change transactions."
              : isForeverLease(enabledUntil!)
                ? "Claude can add and change transactions until you turn it off."
                : `Claude can add and change transactions until ${formatUntil(enabledUntil!)}.`}
          </p>
          <p className="text-xs text-warm-400 mt-1">
            Each option replaces the current expiry rather than adding to it. A token still needs
            the <code className="font-mono">transactions:write</code> scope as well, which covers
            both adding and changing transactions. This switch turns writing off for every token at
            once.
          </p>
        </div>
      </div>

      {/* Each pill is 30px tall with a 44px hit area (HIT_AREA). The 14px row gap is what keeps
          wrapped rows' hit areas from overlapping: 30 + 14 = 44, so they meet exactly. Overlap
          would send a tap on "1 hour" to whichever pill below it rendered later, "forever" included. */}
      <div className="mt-3 flex flex-wrap gap-x-2 gap-y-3.5">
        {LEASE_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={saving}
            onClick={() => apply(option.lease)}
            className={cn(
              HIT_AREA,
              "px-3 py-1.5 rounded-full text-xs font-medium border border-cream-300 text-warm-500 hover:bg-cream-100 transition-colors disabled:opacity-50"
            )}
          >
            {live ? `Set to ${option.label}` : `Enable ${option.label}`}
          </button>
        ))}
        {live && (
          <button
            type="button"
            disabled={saving}
            onClick={() => apply(null)}
            className={cn(
              HIT_AREA,
              "px-3 py-1.5 rounded-full text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
            )}
          >
            Turn off now
          </button>
        )}
      </div>
    </div>
  );
}
