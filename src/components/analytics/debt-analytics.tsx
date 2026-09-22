"use client";

import Link from "next/link";
import { AlertTriangle, CreditCard, Percent, TrendingDown } from "lucide-react";
import { maskCurrency } from "@/lib/utils";
import { describeCardInterest } from "@/lib/card-interest";
import { useDebtAnalytics, type DebtAnalytics, type DebtStrategyView } from "@/hooks/use-debt-analytics";

interface DebtAnalyticsProps {
  from: string;
  to: string;
  currency: string;
  hideAmounts: boolean;
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (key: string) => `${MONTH[Number(key.slice(5)) - 1]} ${key.slice(2, 4)}`;

/**
 * The portfolio view of what the cards owe, across every card at once.
 *
 * Only what a single card's page cannot say: the total and its trend, interest across all cards,
 * and the two payoff orderings raced against each other. Each card's own terms, payoff table and
 * interest log stay on `/cards/[id]`, where they are edited -- this page reads, it never writes.
 */
export function DebtAnalyticsPanel({ from, to, currency, hideAmounts }: DebtAnalyticsProps) {
  const debt = useDebtAnalytics(from, to);
  const money = (amount: number) => maskCurrency(amount, currency, hideAmounts);

  if (debt.isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="card h-32 animate-shimmer" />
        ))}
      </div>
    );
  }

  if (debt.isError || !debt.data) {
    return (
      <div className="card p-8 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-expense" />
        <p className="mt-3 text-warm-600">Could not load debt analytics.</p>
        <button onClick={() => void debt.refetch()} className="mt-3 min-h-11 px-4 text-sm font-medium text-amber-700">
          Try again
        </button>
      </div>
    );
  }

  const data = debt.data;
  if (data.cards.length === 0) {
    return (
      <div className="card p-8 text-center">
        <CreditCard className="mx-auto h-6 w-6 text-income" />
        <p className="mt-3 font-medium text-warm-700">Nothing owed on any card</p>
        <p className="mt-1 text-sm text-warm-400">Every card is paid off or holding a credit.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Headline data={data} money={money} />
      <OwedTrend data={data} money={money} />
      <CardsTable data={data} money={money} />
      {data.strategies && <Strategies strategies={data.strategies} names={data.cards} money={money} />}
    </div>
  );
}

function Headline({ data, money }: { data: DebtAnalytics; money: (n: number) => string }) {
  const interest = describeCardInterest(data.interest);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="card p-5">
        <p className="text-sm text-warm-400">Owed across all cards</p>
        <p className="font-serif text-3xl text-warm-700">{money(data.totalOwed)}</p>
      </div>
      <div className="card p-5">
        <p className="text-sm text-warm-400">Interest and fees this period</p>
        {/* "Not tracked" rather than zero: see describeCardInterest. */}
        <p className="font-serif text-3xl text-warm-700">
          {interest.state === "charged" ? money(interest.amount) : interest.state === "untracked" ? "Not tracked" : "None"}
        </p>
        {interest.state === "untracked" && (
          <p className="mt-1 text-xs text-warm-400">Log interest on each card so the balances stay honest.</p>
        )}
      </div>
    </div>
  );
}

/** A bar per month, scaled to the largest. Enough to read direction without a chart library. */
function OwedTrend({ data, money }: { data: DebtAnalytics; money: (n: number) => string }) {
  const peak = Math.max(1, ...data.owedOverTime.map((point) => point.owed));
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <TrendingDown aria-hidden="true" className="h-5 w-5 text-amber-dark" />
        <h2 className="font-serif text-lg text-warm-700">Owed over time</h2>
      </div>
      <ul className="space-y-1.5">
        {data.owedOverTime.map((point) => (
          <li key={point.month} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 text-sm">
            <span className="text-warm-400">{monthLabel(point.month)}</span>
            <span className="h-2 overflow-hidden rounded-full bg-cream-100">
              <span className="block h-full rounded-full bg-amber" style={{ width: `${(Math.max(0, point.owed) / peak) * 100}%` }} />
            </span>
            <span className="text-right text-warm-700">{money(point.owed)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CardsTable({ data, money }: { data: DebtAnalytics; money: (n: number) => string }) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Percent aria-hidden="true" className="h-5 w-5 text-amber-dark" />
        <h2 className="font-serif text-lg text-warm-700">By card</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-warm-400">
              <th scope="col" className="pb-1 pr-3 font-medium">Card</th>
              <th scope="col" className="pb-1 pr-3 font-medium">Owes</th>
              <th scope="col" className="pb-1 pr-3 font-medium">APR</th>
              <th scope="col" className="pb-1 font-medium">Used</th>
            </tr>
          </thead>
          <tbody>
            {data.cards.map((card) => (
              <tr key={card.id} className="border-t border-cream-200">
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  <Link href={`/cards/${card.id}`} className="inline-flex min-h-11 items-center text-amber-dark underline">
                    {card.name}
                  </Link>
                </th>
                <td className="py-2 pr-3 text-warm-700">{money(card.balance)}</td>
                <td className="py-2 pr-3 text-warm-700">{card.apr === null ? "—" : `${card.apr}%`}</td>
                <td className="py-2 text-warm-700">{card.utilization === null ? "—" : `${card.utilization}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-warm-400">
        Each card&apos;s payoff dates and its terms are on the card itself.
      </p>
    </section>
  );
}

/**
 * The sentence under the two orderings, judged on each one's own outcome.
 *
 * The two can stall independently. At 48% APR on 60,000 with 2,500 a month, highest-rate-first
 * clears in about eleven years while smallest-balance-first never does: it spends the surplus on the
 * small card while the big one outgrows the pool. Comparing their month counts then read a stalled
 * run's zeros as a free result and said the two "come out the same" -- the exact opposite of the
 * truth, in the one situation where the order matters most. So a stalled ordering is never compared
 * as a number; it is named.
 */
export const strategyVerdict = (
  avalanche: DebtStrategyView,
  snowball: DebtStrategyView,
  money: (n: number) => string,
): string => {
  if (avalanche.stalled && snowball.stalled) {
    return "Neither order clears the cards within 50 years at this amount. The order is not the problem; the amount is.";
  }
  if (snowball.stalled) {
    // No cause given. `stalled` covers two cases -- the dear card outgrowing the payment, and a race
    // that is making progress but runs past fifty years -- and a cause is only true of the first.
    return "Only highest rate first clears these cards within 50 years at this amount.";
  }
  if (avalanche.stalled) {
    return "Only smallest balance first clears these cards within 50 years at this amount.";
  }

  const monthsSaved = snowball.months - avalanche.months;
  const interestSaved = Math.round((snowball.totalInterest - avalanche.totalInterest) * 100) / 100;
  if (interestSaved <= 0 && monthsSaved <= 0) {
    return "Both orders come out about the same here, so pick whichever keeps you paying.";
  }
  const months = monthsSaved > 0 ? ` and ${monthsSaved} ${monthsSaved === 1 ? "month" : "months"}` : "";
  return `Highest rate first saves about ${money(interestSaved)}${months}. Smallest balance first clears a card sooner, which some people find easier to keep going with.`;
};

/**
 * Avalanche against snowball on the same money. The useful reading is the gap, and with two or
 * three cards it is usually small -- so this says how small rather than implying the choice is big.
 */
function Strategies({
  strategies,
  names,
  money,
}: {
  strategies: NonNullable<DebtAnalytics["strategies"]>;
  names: DebtAnalytics["cards"];
  money: (n: number) => string;
}) {
  const nameOf = (id: string) => names.find((card) => card.id === id)?.name ?? "A card";
  const { avalanche, snowball } = strategies;

  return (
    <section className="card p-5">
      <h2 className="font-serif text-lg text-warm-700">Which card first</h2>
      <p className="mt-1 text-sm text-warm-400">Paying {money(strategies.monthlyPool)} a month across the cards.</p>
      {!(avalanche.stalled && snowball.stalled) && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StrategyBox title="Highest rate first" subtitle="Avalanche" result={avalanche} nameOf={nameOf} money={money} />
          <StrategyBox title="Smallest balance first" subtitle="Snowball" result={snowball} nameOf={nameOf} money={money} />
        </div>
      )}
      <p className="mt-3 text-sm text-warm-600">{strategyVerdict(avalanche, snowball, money)}</p>
    </section>
  );
}

function StrategyBox({
  title,
  subtitle,
  result,
  nameOf,
  money,
}: {
  title: string;
  subtitle: string;
  result: DebtStrategyView;
  nameOf: (id: string) => string;
  money: (n: number) => string;
}) {
  return (
    <div className="rounded-xl border border-cream-200 p-4">
      <p className="font-medium text-warm-700">{title}</p>
      <p className="text-xs text-warm-400">{subtitle}</p>
      {/* A stalled run carries months: 0 and interest: 0. Printing those would read as free. */}
      {result.stalled ? (
        <p className="mt-2 text-sm text-expense">Does not clear within 50 years at this amount</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-warm-600">
            Clear in {result.months} {result.months === 1 ? "month" : "months"}, {money(result.totalInterest)} in interest
          </p>
          <p className="mt-1 text-xs text-warm-400">Order: {result.order.map(nameOf).join(" → ")}</p>
        </>
      )}
    </div>
  );
}
