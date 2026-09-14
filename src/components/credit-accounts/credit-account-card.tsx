"use client";

import Link from "next/link";
import { CreditCard } from "lucide-react";
import { cn, maskCurrency } from "@/lib/utils";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import type { CreditAccountView } from "@/hooks/use-credit-accounts";

/** Share of the limit in use, 0-100, or null with no limit. Clamped for the bar; over the limit reads 100. */
export const limitUsedPercent = (balance: number, creditLimit: number | null): number | null => {
  if (!creditLimit) return null;
  return Math.min(100, Math.max(0, Math.round((balance / creditLimit) * 100)));
};

/** 1st, 2nd, 3rd, 4th, 11th, 21st, 22nd. */
export const ordinalDay = (day: number): string => {
  const suffixes = ["th", "st", "nd", "rd"];
  const lastTwo = day % 100;
  return `${day}${suffixes[(lastTwo - 20) % 10] ?? suffixes[lastTwo] ?? suffixes[0]}`;
};

export function CreditAccountCard({ account }: { account: CreditAccountView }) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const used = limitUsedPercent(account.balance, account.creditLimit);
  // An overpayment leaves the card holding money, which is good news and should not read as debt.
  const holdsCredit = account.balance < 0;

  return (
    <Link href={`/cards/${account.id}`} className="card-hover block p-5">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${account.color}18` }}
        >
          <CreditCard className="h-5 w-5" style={{ color: account.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-warm-600">{account.name}</p>
          <p className="text-xs text-warm-400">
            {account.dueDay ? `Due on the ${ordinalDay(account.dueDay)}` : "No due day set"}
          </p>
        </div>
        {!account.isActive && (
          <span className="shrink-0 rounded-full bg-cream-100 px-2 py-0.5 text-[10px] font-medium text-warm-500">
            Archived
          </span>
        )}
      </div>

      <p className="mt-4 text-xs text-warm-400">{holdsCredit ? "Credit on card" : "You owe"}</p>
      <p className={cn("font-serif text-2xl", holdsCredit ? "text-income" : "text-warm-700")}>
        {maskCurrency(Math.abs(account.balance), user.currency, hideAmounts)}
      </p>

      {used !== null && account.creditLimit !== null && (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label="Credit limit used"
            aria-valuenow={used}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-full bg-cream-100"
          >
            <div
              className={cn("h-full rounded-full", used >= 90 ? "bg-expense" : "bg-amber")}
              style={{ width: `${used}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-warm-400">
            {used}% of {maskCurrency(account.creditLimit, user.currency, hideAmounts)} limit
          </p>
        </div>
      )}
    </Link>
  );
}
