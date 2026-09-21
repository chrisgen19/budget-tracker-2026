"use client";

import { Percent } from "lucide-react";
import { maskCurrency } from "@/lib/utils";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { userToday } from "@/lib/bill-dates";
import { comparePayoffs, type PayoffOutcome } from "@/lib/debt-payoff";
import type { CreditAccountView } from "@/hooks/use-credit-accounts";

interface CardCostOfCarryProps {
  account: CreditAccountView;
  observedMonthlyPayment: number | null;
  onEdit: () => void;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `2027-11-14` as `November 2027`. A payoff two years out does not need a day. */
const monthLabel = (day: string): string => {
  const [year, month] = day.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
};

const durationLabel = (months: number): string => {
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearPart = `${years} ${years === 1 ? "year" : "years"}`;
  return rest === 0 ? yearPart : `${yearPart} ${rest}m`;
};

const UNKNOWN_COPY: Record<string, string> = {
  "no-apr": "Add this card's APR",
  "no-minimum": "Add the minimum payment",
  "too-little-history": "Too few payments logged yet",
  "not-planned": "No planned payment set",
};

/** One basis, as a payoff cell and an interest cell. */
function OutcomeRow({
  label,
  detail,
  outcome,
  money,
}: {
  label: string;
  detail?: string;
  outcome: PayoffOutcome;
  money: (amount: number) => string;
}) {
  const payoff =
    outcome.status === "clears"
      ? monthLabel(outcome.payoffDate)
      : outcome.status === "never-clears"
        ? "Never clears"
        : outcome.status === "beyond-horizon"
          ? "Over 50 years"
          : outcome.status === "settled"
            ? "Nothing owed"
            : UNKNOWN_COPY[outcome.reason];

  return (
    <tr className="border-t border-cream-200">
      <th scope="row" className="py-2 pr-3 text-left align-top font-medium text-warm-600">
        {label}
        {detail && <span className="block text-xs font-normal text-warm-400">{detail}</span>}
      </th>
      <td className="py-2 pr-3 align-top text-warm-700">
        {payoff}
        {outcome.status === "clears" && (
          <span className="block text-xs text-warm-400">{durationLabel(outcome.months)}</span>
        )}
      </td>
      <td className="py-2 align-top text-warm-700">
        {outcome.status === "clears" ? money(outcome.totalInterest) : "—"}
      </td>
    </tr>
  );
}

/**
 * What this card costs to carry, and when it clears on each of three bases.
 *
 * Three rather than one because the useful reading is the gap between them: what the bank asks for,
 * what is actually being paid, and what was planned. Each is withheld on its own account, so a card
 * with no plan still shows its minimum.
 */
export function CardCostOfCarry({ account, observedMonthlyPayment, onEdit }: CardCostOfCarryProps) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const money = (amount: number) => maskCurrency(amount, user.currency, hideAmounts);

  // Nothing to say about paying off a card that owes nothing.
  if (account.balance <= 0) return null;

  const payoffs = comparePayoffs({
    balance: account.balance,
    apr: account.apr,
    minimumPct: account.minimumPaymentPct,
    minimumFloor: account.minimumPaymentFloor,
    plannedPayment: account.plannedPayment,
    observedMonthly: observedMonthlyPayment,
    from: userToday(user.timezoneOffset),
  });

  return (
    <section className="card mb-4 p-5">
      <div className="mb-1 flex items-center gap-2">
        <Percent aria-hidden="true" className="h-5 w-5 text-amber-dark" />
        <h2 className="font-serif text-lg text-warm-700">Cost of carry</h2>
      </div>

      {account.apr === null ? (
        <p className="mt-2 text-sm text-warm-400">
          Add this card&apos;s APR to see when it clears and what carrying it costs.{" "}
          <button type="button" onClick={onEdit} className="font-medium text-amber-dark underline">
            Edit card
          </button>
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-warm-400">
            At {account.apr}% APR on {money(account.balance)}.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-warm-400">
                  <th scope="col" className="pb-1 pr-3 font-medium">Paying</th>
                  <th scope="col" className="pb-1 pr-3 font-medium">Clears</th>
                  <th scope="col" className="pb-1 font-medium">Interest from here</th>
                </tr>
              </thead>
              <tbody>
                <OutcomeRow label="The minimum" outcome={payoffs.minimum} money={money} />
                <OutcomeRow
                  label="Your average"
                  detail={
                    payoffs.observedMonthly === null
                      ? undefined
                      : `${money(payoffs.observedMonthly)}/mo over 6 months`
                  }
                  outcome={payoffs.observed}
                  money={money}
                />
                <OutcomeRow
                  label="Your plan"
                  detail={
                    account.plannedPayment === null
                      ? undefined
                      : `${money(account.plannedPayment)}/mo`
                  }
                  outcome={payoffs.planned}
                  money={money}
                />
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-warm-400">
            A projection, not a promise: it assumes no further purchases on this card, and that
            interest is charged before each payment lands. Set the terms on{" "}
            <button type="button" onClick={onEdit} className="font-medium text-amber-dark underline">
              the card
            </button>
            , and use Log Interest above so what the bank charges reaches the balance.
          </p>
        </>
      )}
    </section>
  );
}
