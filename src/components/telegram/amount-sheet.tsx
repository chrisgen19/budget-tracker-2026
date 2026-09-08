"use client";

import { Delete } from "lucide-react";
import { useState } from "react";
import { padAmount, padDisplay, pressKey, type PadKey } from "@/components/telegram/amount-pad";
import { useMainButton, useHaptics } from "@/components/telegram/use-telegram-webapp";

/**
 * The numeric pad, for a tile that asks rather than asserts.
 *
 * A custom keypad, not an `<input type="number">`. The OS keyboard never opens, so the viewport
 * never resizes mid-entry and the whole class of keyboard-layout problems simply does not arise.
 * Committing happens on Telegram's own MainButton, which is the platform convention and gets
 * keyboard-safe placement for free.
 */

const KEYS: PadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

interface AmountSheetProps {
  webApp: TelegramWebApp | null;
  title: string;
  currency: string;
  /** Prefilled for a Frequent entry whose amount is not stable enough to log on one tap. */
  initial?: number | null;
  busy: boolean;
  onSubmit: (amount: number) => void;
}

export function AmountSheet({
  webApp,
  title,
  currency,
  initial,
  busy,
  onSubmit,
}: AmountSheetProps) {
  const [entry, setEntry] = useState(initial != null ? String(initial) : "");
  const { tapped } = useHaptics(webApp);

  const amount = padAmount(entry);

  useMainButton(webApp, {
    text: amount === null ? "Enter an amount" : `Log ${format(currency, amount)}`,
    visible: true,
    // Disabled rather than hidden while the entry is unusable, so the commit control stays where
    // the thumb expects it instead of appearing under it once a digit lands.
    enabled: amount !== null && !busy,
    onClick: () => {
      if (amount !== null && !busy) onSubmit(amount);
    },
  });

  const press = (key: PadKey) => {
    tapped();
    setEntry((current) => pressKey(current, key));
  };

  return (
    <div className="flex min-h-[var(--tg-vh,100dvh)] flex-col p-4">
      <p className="text-sm text-warm-600">{title}</p>

      <div className="flex flex-1 items-center justify-center py-6">
        <p className="font-display text-5xl font-semibold tabular-nums text-warm-800">
          <span className="mr-1 text-2xl text-warm-500">{symbol(currency)}</span>
          {padDisplay(entry)}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            // A pad key is the most-tapped control here, so it is deliberately large: h-16 is far
            // past the 44px minimum and is what makes three taps reliable one-handed.
            className="flex h-16 items-center justify-center rounded-2xl bg-white text-2xl font-medium text-warm-800 shadow-soft transition active:scale-95 active:bg-cream-200"
            aria-label={key === "back" ? "Delete" : key}
          >
            {key === "back" ? <Delete className="h-6 w-6" aria-hidden /> : key}
          </button>
        ))}
      </div>

      {/* An in-page fallback for the commit, because MainButton is absent outside Telegram --
          which is how this page is reached in a browser during development. */}
      {!webApp ? (
        <button
          type="button"
          disabled={amount === null || busy}
          onClick={() => amount !== null && onSubmit(amount)}
          className="mt-3 min-h-11 rounded-2xl bg-amber py-3 font-medium text-white disabled:opacity-50"
        >
          {amount === null ? "Enter an amount" : `Log ${format(currency, amount)}`}
        </button>
      ) : null}
    </div>
  );
}

const format = (currency: string, amount: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);

/** The currency's symbol alone, for the large display where a formatted string would be noise. */
const symbol = (currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency })
    .formatToParts(0)
    .find((part) => part.type === "currency")?.value ?? currency;
