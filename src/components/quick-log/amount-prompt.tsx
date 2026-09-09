"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { getCurrencySymbol } from "@/lib/utils";
import { parseAmount } from "@/components/quick-log/quick-tile-form";

interface AmountPromptProps {
  /** What the button reads, so the prompt says which one is being logged. */
  label: string;
  currency: string;
  busy: boolean;
  onSubmit: (amount: number) => void;
  onCancel: () => void;
}

/**
 * The amount for a button that asks.
 *
 * A plain `inputMode="decimal"` field, not the custom keypad the Mini App uses. That keypad exists
 * for one Telegram-specific reason -- an OS keyboard resizes the webview mid-entry and a layout
 * pinned to the viewport jumps on every focus -- which does not apply to a browser. Building a
 * second keypad here would be a second thing to maintain for a problem this surface does not have.
 */
export function AmountPrompt({ label, currency, busy, onSubmit, onCancel }: AmountPromptProps) {
  const [raw, setRaw] = useState("");
  const amount = parseAmount(raw);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (amount !== null && !busy) onSubmit(amount);
      }}
      className="space-y-4"
    >
      <p className="text-sm text-warm-500">
        How much for <strong className="font-medium text-warm-700">{label}</strong>?
      </p>

      <div className="flex items-center gap-2 rounded-xl border border-cream-300 bg-white px-3 focus-within:border-amber">
        <span className="font-display text-lg text-warm-400">{getCurrencySymbol(currency)}</span>
        <input
          // Autofocused because the whole point of this screen is that it is one field between a
          // tap and a logged transaction.
          autoFocus
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="0.00"
          aria-label={`Amount for ${label}`}
          className="min-h-12 w-full bg-transparent py-2 font-display text-xl text-warm-700 outline-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 flex-1 rounded-xl border border-cream-300 bg-white px-4 text-sm font-medium text-warm-600 transition hover:bg-cream-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={amount === null || busy}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-dark disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Log it
        </button>
      </div>
    </form>
  );
}
