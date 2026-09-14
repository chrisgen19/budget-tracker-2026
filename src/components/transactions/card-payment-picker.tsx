"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { cn, maskCurrency } from "@/lib/utils";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { useCreditAccountsQuery } from "@/hooks/use-credit-accounts";

const OPTION =
  "inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border px-3 text-sm transition-colors";

interface CardPaymentPickerProps {
  value: string | null;
  onChange: (creditAccountId: string | null) => void;
  /** For a new payment and exactly one card, choose that card once: the usual case, one tap saved. */
  preselectOnlyCard: boolean;
}

/**
 * Which card a "Credit Card Payment" pays down.
 *
 * Mounted only once that category is chosen, so every other use of the transaction form never
 * fetches cards at all. Optional on purpose: paying a card that is not tracked here is still a real
 * expense, and a bill payment is linked to its card on the server either way.
 */
export function CardPaymentPicker({ value, onChange, preselectOnlyCard }: CardPaymentPickerProps) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const { data: cards = [], isLoading, isError } = useCreditAccountsQuery();
  // Once only, so choosing "No card" is not immediately undone.
  const preselected = useRef(false);

  useEffect(() => {
    if (preselected.current || !preselectOnlyCard || isLoading) return;
    preselected.current = true;
    if (value === null && cards.length === 1) onChange(cards[0].id);
  }, [preselectOnlyCard, isLoading, value, cards, onChange]);

  const linkedToArchived = value !== null && !isLoading && !cards.some((card) => card.id === value);

  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-warm-600">Pays down</p>
      {isLoading ? (
        <div className="h-11 rounded-xl animate-shimmer" />
      ) : isError ? (
        <p className="text-sm text-expense">
          Couldn&apos;t load your cards. The payment still saves as an expense.
        </p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-warm-400">
          No cards yet.{" "}
          <Link href="/cards" className="font-medium text-amber-dark underline">
            Add one
          </Link>{" "}
          to track what you owe on it.
        </p>
      ) : (
        <div role="radiogroup" aria-label="Card this payment pays down" className="flex flex-wrap gap-2">
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              role="radio"
              aria-checked={value === card.id}
              onClick={() => onChange(card.id)}
              className={cn(
                OPTION,
                value === card.id
                  ? "border-amber bg-amber-light/50 text-warm-700"
                  : "border-cream-300 text-warm-500 hover:border-cream-400"
              )}
            >
              <CreditCard className="h-4 w-4 shrink-0" style={{ color: card.color }} />
              <span className="truncate">{card.name}</span>
              <span className="shrink-0 text-xs text-warm-400">
                {maskCurrency(card.balance, user.currency, hideAmounts)}
              </span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={value === null}
            onClick={() => onChange(null)}
            className={cn(
              OPTION,
              value === null
                ? "border-amber bg-amber-light/50 text-warm-700"
                : "border-cream-300 text-warm-500 hover:border-cream-400"
            )}
          >
            No card
          </button>
        </div>
      )}
      {linkedToArchived && (
        <p className="mt-2 text-xs text-warm-400">Linked to an archived card. Saving keeps that link.</p>
      )}
    </div>
  );
}
