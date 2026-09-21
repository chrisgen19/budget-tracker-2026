"use client";

import { cn, maskCurrency } from "@/lib/utils";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { describeCardInterest, type CardInterestFacts } from "@/lib/card-interest";
import type { CreditAccountView, LedgerTotalsView } from "@/hooks/use-credit-accounts";

interface CardSummaryProps {
  account: CreditAccountView;
  /** What moved in the month on screen. The balance above it is all-time. */
  monthTotals: LedgerTotalsView;
  interest: CardInterestFacts;
}

export function CardSummary({ account, monthTotals, interest }: CardSummaryProps) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const money = (amount: number) => maskCurrency(amount, user.currency, hideAmounts);
  const holdsCredit = account.balance < 0;
  const interestState = describeCardInterest(interest);

  const stats = [
    { label: "Bought this month", value: money(monthTotals.purchases) },
    { label: "Paid this month", value: money(monthTotals.payments) },
    ...(monthTotals.credits > 0 ? [{ label: "Refunded", value: money(monthTotals.credits) }] : []),
    // "Not tracked" rather than a zero. A card that has never had interest logged is not a card
    // that costs nothing to carry, and the two must not render alike.
    {
      label: "Interest & fees",
      value: interestState.state === "charged" ? money(interestState.amount) : "None",
      muted: interestState.state !== "charged",
    },
    ...(account.availableCredit !== null
      ? [{ label: "Available credit", value: money(account.availableCredit) }]
      : []),
  ];

  return (
    <div className="card mb-4 p-5">
      <p className="text-sm text-warm-400">{holdsCredit ? "Credit on card" : "You owe"}</p>
      <p className={cn("font-serif text-3xl", holdsCredit ? "text-income" : "text-warm-700")}>
        {money(Math.abs(account.balance))}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-xs text-warm-400">{stat.label}</dt>
            <dd className={cn("text-sm font-medium", stat.muted ? "text-warm-400" : "text-warm-700")}>
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* The balance above is derived from purchases and payments alone. Interest raises what the
          card really owes, so while none is logged that figure drifts below the statement. */}
      {interestState.state === "untracked" && account.balance > 0 && (
        <p className="mt-4 rounded-xl border border-amber/30 bg-amber/10 p-3 text-xs text-warm-600">
          No interest or fees have been logged on this card, so this balance only counts purchases
          and payments. If the bank charges you interest, log it to keep the balance honest.
        </p>
      )}
    </div>
  );
}
