"use client";

import { cn, maskCurrency } from "@/lib/utils";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import type { CreditAccountView, LedgerTotalsView } from "@/hooks/use-credit-accounts";

interface CardSummaryProps {
  account: CreditAccountView;
  /** What moved in the month on screen. The balance above it is all-time. */
  monthTotals: LedgerTotalsView;
}

export function CardSummary({ account, monthTotals }: CardSummaryProps) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const money = (amount: number) => maskCurrency(amount, user.currency, hideAmounts);
  const holdsCredit = account.balance < 0;

  const stats = [
    { label: "Charged this month", value: money(monthTotals.charges) },
    ...(monthTotals.credits > 0 ? [{ label: "Refunded", value: money(monthTotals.credits) }] : []),
    { label: "Paid this month", value: money(monthTotals.payments) },
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
            <dd className="text-sm font-medium text-warm-700">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
