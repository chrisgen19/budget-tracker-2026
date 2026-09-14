"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, CreditCard, Landmark } from "lucide-react";
import { cn, maskCurrency } from "@/lib/utils";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { useCreditAccountsQuery } from "@/hooks/use-credit-accounts";

const OPTION =
  "inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border px-3 text-sm transition-colors";
const SELECTED = "border-amber bg-amber-light/50 text-warm-700";
const UNSELECTED = "border-cream-300 text-warm-500 hover:border-cream-400";

interface PaidWithOptionsProps {
  value: string | null;
  onChange: (creditAccountId: string | null) => void;
}

/** The choices, mounted only once the field is opened, so cards are fetched only by someone asking. */
function PaidWithOptions({ value, onChange }: PaidWithOptionsProps) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const { data: cards = [], isLoading, isError } = useCreditAccountsQuery();

  if (isLoading) return <div className="h-11 rounded-xl animate-shimmer" />;
  if (isError) {
    return <p className="text-sm text-expense">Couldn&apos;t load your cards. Try again in a moment.</p>;
  }

  const linkedToArchived = value !== null && !cards.some((card) => card.id === value);

  return (
    <div>
      <div role="radiogroup" aria-label="Paid with" className="flex flex-wrap gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          onClick={() => onChange(null)}
          className={cn(OPTION, value === null ? SELECTED : UNSELECTED)}
        >
          <Landmark className="h-4 w-4 shrink-0" />
          Bank / cash
        </button>
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            role="radio"
            aria-checked={value === card.id}
            onClick={() => onChange(card.id)}
            className={cn(OPTION, value === card.id ? SELECTED : UNSELECTED)}
          >
            <CreditCard className="h-4 w-4 shrink-0" style={{ color: card.color }} />
            <span className="truncate">{card.name}</span>
            <span className="shrink-0 text-xs text-warm-400">
              {maskCurrency(card.balance, user.currency, hideAmounts)}
            </span>
          </button>
        ))}
      </div>
      {cards.length === 0 && (
        <p className="mt-2 text-xs text-warm-400">
          No cards yet.{" "}
          <Link href="/cards" className="font-medium text-amber-dark underline">
            Add one
          </Link>{" "}
          to track purchases made with it.
        </p>
      )}
      {linkedToArchived && (
        <p className="mt-2 text-xs text-warm-400">Paid with an archived card. Saving keeps that.</p>
      )}
    </div>
  );
}

interface PaidWithFieldProps {
  value: string | null;
  onChange: (creditAccountId: string | null) => void;
  /** The linked card's name when editing, so the closed field can say it without fetching cards. */
  linkedCardName?: string | null;
}

/**
 * How an expense was paid: bank or cash, or one of the user's credit cards.
 *
 * A purchase paid with a card is still an ordinary expense in every report; the choice only adds it
 * to what that card owes. Closed until tapped, and closed means no request: the transaction form is
 * shared by receipts, bills and quick add, and none of them should pay for a field most rows skip.
 */
export function PaidWithField({ value, onChange, linkedCardName }: PaidWithFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-warm-600">Paid with</p>
      {open ? (
        <PaidWithOptions value={value} onChange={onChange} />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="flex min-h-11 w-full items-center justify-between rounded-xl border border-cream-200 px-4 text-sm text-warm-600 transition-colors hover:border-cream-300"
        >
          <span className="flex min-w-0 items-center gap-2">
            {value ? <CreditCard className="h-4 w-4 shrink-0" /> : <Landmark className="h-4 w-4 shrink-0" />}
            <span className="truncate">{value ? linkedCardName ?? "Credit card" : "Bank / cash"}</span>
          </span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-warm-400" />
        </button>
      )}
    </div>
  );
}
