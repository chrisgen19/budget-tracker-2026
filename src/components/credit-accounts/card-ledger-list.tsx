"use client";

import Link from "next/link";
import { ArrowDownLeft, Pencil, Trash2 } from "lucide-react";
import { cn, maskCurrency, TOUCH_HIT_AREA_CENTERED } from "@/lib/utils";
import { accountDateKey } from "@/lib/account-time";
import { formatDayKey } from "@/lib/month-key";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { CategoryIcon } from "@/components/ui/icon-map";
import type { CardPaymentView, CreditChargeView } from "@/hooks/use-credit-accounts";

export type LedgerEntry =
  | { type: "charge"; date: string; charge: CreditChargeView }
  | { type: "payment"; date: string; payment: CardPaymentView };

/** Charges and payments as one list, newest first. ISO instants sort correctly as plain strings. */
export const mergeLedger = (
  charges: readonly CreditChargeView[],
  payments: readonly CardPaymentView[]
): LedgerEntry[] =>
  [
    ...charges.map((charge) => ({ type: "charge" as const, date: charge.date, charge })),
    ...payments.map((payment) => ({ type: "payment" as const, date: payment.date, payment })),
  ].sort((a, b) => b.date.localeCompare(a.date));

const ICON_BUTTON = cn(
  "relative flex h-9 w-9 items-center justify-center rounded-lg text-warm-300 transition-colors",
  TOUCH_HIT_AREA_CENTERED
);

interface ChargeRowProps {
  charge: CreditChargeView;
  day: string;
  money: (amount: number) => string;
  onEdit: () => void;
  onDelete: () => void;
}

function ChargeRow({ charge, day, money, onEdit, onDelete }: ChargeRowProps) {
  const refund = charge.kind === "CREDIT";
  const title = charge.description || charge.category.name;
  const foreign =
    charge.originalCurrency && charge.originalAmount !== null
      ? ` · ${charge.originalCurrency} ${charge.originalAmount.toFixed(2)}`
      : "";

  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${charge.category.color}18` }}
      >
        <CategoryIcon name={charge.category.icon} className="h-4 w-4" style={{ color: charge.category.color }} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-warm-600">{title}</p>
        <p className="truncate text-xs text-warm-400">
          {day} · {refund ? "Refund" : charge.category.name}
          {foreign}
        </p>
      </div>
      <span className={cn("shrink-0 text-sm font-medium", refund ? "text-income" : "text-warm-700")}>
        {refund && "-"}
        {money(charge.amount)}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" aria-label={`Edit ${title}`} onClick={onEdit} className={cn(ICON_BUTTON, "hover:bg-amber-light hover:text-amber")}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label={`Delete ${title}`} onClick={onDelete} className={cn(ICON_BUTTON, "hover:bg-expense-light hover:text-expense")}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function PaymentRow({ payment, day, money }: { payment: CardPaymentView; day: string; money: (amount: number) => string }) {
  return (
    <li>
      {/* The payment is an ordinary transaction, so it is edited where every transaction is. */}
      <Link
        href={`/transactions?highlight=${payment.id}`}
        className="flex min-h-11 items-center gap-3 py-3 transition-colors hover:bg-cream-50"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-income-light">
          <ArrowDownLeft className="h-4 w-4 text-income" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-warm-600">{payment.description || "Payment"}</p>
          <p className="truncate text-xs text-warm-400">{day} · Payment</p>
        </div>
        <span className="shrink-0 text-sm font-medium text-income">-{money(payment.amount)}</span>
      </Link>
    </li>
  );
}

interface CardLedgerListProps {
  charges: CreditChargeView[];
  payments: CardPaymentView[];
  onEditCharge: (charge: CreditChargeView) => void;
  onDeleteCharge: (charge: CreditChargeView) => void;
}

export function CardLedgerList({ charges, payments, onEditCharge, onDeleteCharge }: CardLedgerListProps) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const entries = mergeLedger(charges, payments);
  const money = (amount: number) => maskCurrency(amount, user.currency, hideAmounts);
  const dayOf = (instant: string) => formatDayKey(accountDateKey(instant, user.timezoneOffset));

  if (entries.length === 0) {
    return <p className="text-sm text-warm-400">Nothing on this card this month.</p>;
  }

  return (
    <ul className="divide-y divide-cream-300/40">
      {entries.map((entry) =>
        entry.type === "charge" ? (
          <ChargeRow
            key={`charge-${entry.charge.id}`}
            charge={entry.charge}
            day={dayOf(entry.date)}
            money={money}
            onEdit={() => onEditCharge(entry.charge)}
            onDelete={() => onDeleteCharge(entry.charge)}
          />
        ) : (
          <PaymentRow key={`payment-${entry.payment.id}`} payment={entry.payment} day={dayOf(entry.date)} money={money} />
        )
      )}
    </ul>
  );
}
