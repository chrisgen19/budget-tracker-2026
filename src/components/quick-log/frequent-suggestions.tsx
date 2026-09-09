"use client";

import { Plus, Repeat } from "lucide-react";
import type { FrequentTile } from "@/lib/telegram/frequent-tiles";
import { usePrivacy } from "@/components/privacy-provider";
import { maskCurrency } from "@/lib/utils";

interface FrequentSuggestionsProps {
  entries: FrequentTile[];
  currency: string;
  loading: boolean;
  /** True when the grid is full, so making a button from here could only be refused. */
  atLimit: boolean;
  onMakeButton: (entry: FrequentTile) => void;
}

/**
 * What the ledger says you keep logging, offered as buttons you have not made yet.
 *
 * Configured buttons answer "what do I spend on every day", which somebody has to sit down and
 * decide. This answers it from what was actually logged and keeps answering it as habits change -
 * the part of the grid that needs no maintenance.
 *
 * Read-only here, unlike the Mini App where a Frequent entry can be tapped to log. This page is
 * where buttons are *made*, and a section that both logs and creates would have two meanings for
 * one card. The one action is "make a button", after which the entry drops out of this list by
 * itself: the server excludes a configured tile's description by token containment, so every
 * spelling of it goes with it.
 */
export function FrequentSuggestions({
  entries,
  currency,
  loading,
  atLimit,
  onMakeButton,
}: FrequentSuggestionsProps) {
  const { hideAmounts } = usePrivacy();

  if (loading) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-shimmer rounded-xl bg-cream-200" />
        ))}
      </div>
    );
  }

  // Silent when there is nothing to suggest. An empty "we found nothing" panel takes up the same
  // room as a useful one and says less than showing nothing at all.
  if (entries.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-1 flex items-center gap-2 font-serif text-lg text-warm-600">
        <Repeat className="h-4 w-4 text-warm-400" aria-hidden />
        From what you log
      </h2>
      <p className="mb-3 text-sm text-warm-400">
        {atLimit
          ? "Things you have logged repeatedly in the last two months. Your grid is full, so delete a button before adding one of these."
          : "Things you have logged repeatedly in the last two months. Turn one into a button and it stops needing to be typed."}
      </p>

      <ul className="grid gap-2 sm:grid-cols-2">
        {entries.map((entry) => (
          <li
            key={entry.key}
            className="flex items-center justify-between gap-3 rounded-xl border border-cream-300/70 bg-white p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-warm-700">{entry.description}</p>
              <p className="text-xs text-warm-400">
                {entry.count}x
                {/* An unstable amount is deliberately not shown as a figure. The tile it would
                    make asks for one, and printing a number here would promise otherwise. */}
                {entry.amountIsStable && entry.amount !== null
                  ? ` · usually ${maskCurrency(entry.amount, currency, hideAmounts)}`
                  : " · varies"}
                {` · ${entry.categoryName}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onMakeButton(entry)}
              // Disabled rather than left to fail: the grid is full, so this opens a form that can
              // only be refused once it has been filled in. The cap is checked at the edit
              // everywhere else here for the same reason.
              disabled={atLimit}
              aria-label={`Make a button for ${entry.description}`}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-cream-300 px-3 text-sm font-medium text-warm-600 transition hover:border-amber hover:text-amber-dark disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-cream-300 disabled:hover:text-warm-600"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Button
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
