"use client";

import Link from "next/link";
import { ArrowDownLeft, Pencil, Trash2 } from "lucide-react";
import { cn, maskCurrency, TOUCH_HIT_AREA_CENTERED } from "@/lib/utils";
import { accountDateKey } from "@/lib/account-time";
import { formatDayKey } from "@/lib/month-key";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { CategoryIcon } from "@/components/ui/icon-map";
import type { CardPurchaseView, CreditPaymentView } from "@/hooks/use-credit-accounts";

export type LedgerEntry =
  | { type: "purchase"; date: string; purchase: CardPurchaseView }
  | { type: "payment"; date: string; payment: CreditPaymentView };

/** Purchases and payments as one list, newest first. ISO instants sort correctly as plain strings. */
export const mergeLedger = (
  purchases: readonly CardPurchaseView[],
  payments: readonly CreditPaymentView[]
): LedgerEntry[] =>
  [
    ...purchases.map((purchase) => ({ type: "purchase" as const, date: purchase.date, purchase })),
    ...payments.map((payment) => ({ type: "payment" as const, date: payment.date, payment })),
  ].sort((a, b) => b.date.localeCompare(a.date));

const ICON_BUTTON = cn(
  "relative flex h-9 w-9 items-center justify-center rounded-lg text-warm-300 transition-colors",
  TOUCH_HIT_AREA_CENTERED
);

type Money = (amount: number) => string;

function PurchaseRow({ purchase, day, money }: { purchase: CardPurchaseView; day: string; money: Money }) {
  const labels = purchase.labels.map((link) => link.label.name).join(", ");
  return (
    <li>
      {/* A purchase is an ordinary transaction, so it is edited where every transaction is. */}
      <Link
        href={`/transactions?highlight=${purchase.id}`}
        className="flex min-h-11 items-center gap-3 py-3 transition-colors hover:bg-cream-50"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${purchase.category.color}18` }}
        >
          <CategoryIcon name={purchase.category.icon} className="h-4 w-4" style={{ color: purchase.category.color }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-warm-600">{purchase.description || purchase.category.name}</p>
          <p className="truncate text-xs text-warm-400">
            {day} · {purchase.category.name}
            {labels && ` · ${labels}`}
          </p>
        </div>
        <span className="shrink-0 text-sm font-medium text-warm-700">{money(purchase.amount)}</span>
      </Link>
    </li>
  );
}

interface PaymentRowProps {
  payment: CreditPaymentView;
  day: string;
  money: Money;
  onEdit: () => void;
  onDelete: () => void;
}

function PaymentRow({ payment, day, money, onEdit, onDelete }: PaymentRowProps) {
  const kindLabel = payment.kind === "CREDIT" ? "Refund" : "Payment";
  const title = payment.description || kindLabel;
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-income-light">
        <ArrowDownLeft className="h-4 w-4 text-income" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-warm-600">{title}</p>
        <p className="truncate text-xs text-warm-400">
          {day} · {kindLabel}
        </p>
      </div>
      <span className="shrink-0 text-sm font-medium text-income">-{money(payment.amount)}</span>
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

interface CardLedgerListProps {
  purchases: CardPurchaseView[];
  payments: CreditPaymentView[];
  onEditPayment: (payment: CreditPaymentView) => void;
  onDeletePayment: (payment: CreditPaymentView) => void;
}

export function CardLedgerList({ purchases, payments, onEditPayment, onDeletePayment }: CardLedgerListProps) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const entries = mergeLedger(purchases, payments);
  const money: Money = (amount) => maskCurrency(amount, user.currency, hideAmounts);
  const dayOf = (instant: string) => formatDayKey(accountDateKey(instant, user.timezoneOffset));

  if (entries.length === 0) {
    return <p className="text-sm text-warm-400">Nothing on this card this month.</p>;
  }

  return (
    <ul className="divide-y divide-cream-300/40">
      {entries.map((entry) =>
        entry.type === "purchase" ? (
          <PurchaseRow key={`purchase-${entry.purchase.id}`} purchase={entry.purchase} day={dayOf(entry.date)} money={money} />
        ) : (
          <PaymentRow
            key={`payment-${entry.payment.id}`}
            payment={entry.payment}
            day={dayOf(entry.date)}
            money={money}
            onEdit={() => onEditPayment(entry.payment)}
            onDelete={() => onDeletePayment(entry.payment)}
          />
        )
      )}
    </ul>
  );
}
