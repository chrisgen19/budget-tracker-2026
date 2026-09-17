"use client";

import { useEffect, useState } from "react";
import { Copy, Radar } from "lucide-react";
import { cn, getCurrencySymbol } from "@/lib/utils";
import { useUser } from "@/components/user-provider";
import { useSavePreference } from "@/hooks/use-save-preference";
import {
  watchlistLargeAmountSchema,
  watchlistOutlierRatioSchema,
} from "@/lib/validations";

const SWITCH_CLASS =
  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30 disabled:cursor-not-allowed disabled:opacity-50 " +
  // The visible track is 24px; this extends the *tap* target to 44px without moving anything.
  "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']";

const INPUT_CLASS =
  "w-28 rounded-xl border border-cream-300 bg-cream-50/50 px-3 py-2.5 text-right text-sm text-warm-700 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30";

/**
 * What counts as an unusual charge, and whether duplicates are worth being told about.
 *
 * These are the only Watchlist settings that are genuinely preferences rather than arithmetic.
 * Everything else the layer reports is measured against the user's own history and needs no
 * opinion from them; how lumpy their spending normally is, and what a large amount means in their
 * currency, are facts about a household that no baseline can infer.
 *
 * Saves through `useSavePreference` like every other preference here, so a refusal is a toast and
 * a rollback rather than a control that silently flips back.
 */
export function WatchlistForm() {
  const { user } = useUser();
  const savePreference = useSavePreference();
  const symbol = getCurrencySymbol(user.currency);

  // Held as the text typed, not as a number: "" and "3." are states a number cannot hold, and the
  // field has to survive being cleared before the next digit arrives.
  const [ratio, setRatio] = useState(String(user.watchlistOutlierRatio));
  const [largeAmount, setLargeAmount] = useState(
    user.watchlistLargeAmount === null ? "" : String(user.watchlistLargeAmount),
  );
  const [savingRatio, setSavingRatio] = useState(false);
  const [savingAmount, setSavingAmount] = useState(false);
  const [savingDuplicates, setSavingDuplicates] = useState(false);

  // A rollback happens in `UserInfo`, so the field has to follow it back or it would keep showing
  // the value the server refused.
  useEffect(() => setRatio(String(user.watchlistOutlierRatio)), [user.watchlistOutlierRatio]);
  useEffect(
    () => setLargeAmount(user.watchlistLargeAmount === null ? "" : String(user.watchlistLargeAmount)),
    [user.watchlistLargeAmount],
  );

  const commitRatio = async () => {
    const parsed = watchlistOutlierRatioSchema.safeParse(Number(ratio));
    // An out-of-range or half-typed value is put back rather than sent. The server would refuse it
    // anyway, and a toast for an edit still in progress is the failure the whole hook exists to
    // avoid producing gratuitously.
    if (!parsed.success || ratio.trim() === "") {
      setRatio(String(user.watchlistOutlierRatio));
      return;
    }
    if (parsed.data === user.watchlistOutlierRatio) return;
    setSavingRatio(true);
    await savePreference("watchlistOutlierRatio", parsed.data, user.watchlistOutlierRatio, "the unusual-charge threshold");
    setSavingRatio(false);
  };

  const commitLargeAmount = async () => {
    // An empty field is the "no absolute figure" state, which is `null` and not 0.
    const next = largeAmount.trim() === "" ? null : Number(largeAmount);
    const parsed = watchlistLargeAmountSchema.safeParse(next);
    if (!parsed.success) {
      setLargeAmount(user.watchlistLargeAmount === null ? "" : String(user.watchlistLargeAmount));
      return;
    }
    if (parsed.data === user.watchlistLargeAmount) return;
    setSavingAmount(true);
    await savePreference("watchlistLargeAmount", parsed.data, user.watchlistLargeAmount, "the large-charge amount");
    setSavingAmount(false);
  };

  const toggleDuplicates = async () => {
    setSavingDuplicates(true);
    await savePreference(
      "watchlistDuplicateAlerts",
      !user.watchlistDuplicateAlerts,
      user.watchlistDuplicateAlerts,
      "duplicate alerts",
    );
    setSavingDuplicates(false);
  };

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="font-serif text-lg text-warm-700">Watchlist</h2>
        <p className="mt-0.5 text-sm text-warm-400">
          What counts as an unusual charge on your account. Every other finding is measured against
          your own history and needs no setting.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-cream-300 bg-cream-50/50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-light">
              <Radar className="h-5 w-5 text-amber-dark" />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-600">Unusual charge threshold</p>
              <p className="text-xs text-warm-400">
                How many times a category&apos;s typical charge before one expense is flagged. Raise
                it if your spending is naturally lumpy.
              </p>
            </div>
          </div>
          <input
            type="number"
            step="0.5"
            min="1.5"
            max="20"
            inputMode="decimal"
            aria-label="Unusual charge threshold"
            value={ratio}
            disabled={savingRatio}
            onChange={(event) => setRatio(event.target.value)}
            onBlur={commitRatio}
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-cream-300 bg-cream-50/50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-light">
              <span className="text-sm font-medium text-amber-dark">{symbol}</span>
            </div>
            <div>
              <p className="text-sm font-medium text-warm-600">Always flag charges above</p>
              <p className="text-xs text-warm-400">
                A figure that is a lot of money whatever the category has cost before. Leave empty
                to judge on the threshold alone.
              </p>
            </div>
          </div>
          <input
            type="number"
            step="1"
            min="0"
            inputMode="decimal"
            placeholder="None"
            aria-label="Always flag charges above"
            value={largeAmount}
            disabled={savingAmount}
            onChange={(event) => setLargeAmount(event.target.value)}
            onBlur={commitLargeAmount}
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-cream-300 bg-cream-50/50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-light">
              <Copy className="h-5 w-5 text-amber-dark" />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-600">Possible duplicate alerts</p>
              <p className="text-xs text-warm-400">
                Duplicates are still detected and still listed in the assessment; this only decides
                whether they appear on the Watchlist.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={user.watchlistDuplicateAlerts}
            aria-label="Possible duplicate alerts"
            disabled={savingDuplicates}
            onClick={toggleDuplicates}
            className={cn(SWITCH_CLASS, user.watchlistDuplicateAlerts ? "bg-amber" : "bg-cream-300")}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                user.watchlistDuplicateAlerts ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
