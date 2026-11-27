"use client";

import { maskCurrency } from "@/lib/utils";
import { useUser } from "@/components/user-provider";
import { usePrivacy } from "@/components/privacy-provider";
// Type-only: `@/lib/receipt-photos` loads sharp and must never reach the client bundle.
import type { ReceiptPhotoInfo } from "@/lib/receipt-photos";

interface ReceiptPhotoLinkedRowsProps {
  data: ReceiptPhotoInfo | undefined;
  isLoading: boolean;
  isError: boolean;
}

const quiet = "text-xs text-warm-400";

/**
 * Every row the photo is attached to, by category and amount, then the receipt total: what a
 * split receipt is shown for when claiming it back. Amounts follow hide-amounts like the list.
 */
export function ReceiptPhotoLinkedRows({ data, isLoading, isError }: ReceiptPhotoLinkedRowsProps) {
  const { user } = useUser();
  const { hideAmounts } = usePrivacy();
  const money = (amount: number) => maskCurrency(amount, user.currency, hideAmounts);

  if (isLoading) return <p className={quiet}>Loading details...</p>;
  if (isError || !data) return <p className={quiet}>The details couldn&apos;t be loaded.</p>;

  const count = data.transactions.length;
  if (count === 0) return <p className={quiet}>Not attached to any transaction yet.</p>;

  return (
    <div>
      <p className={`${quiet} mb-2`}>
        Pinch or scroll to zoom · attached to {count} {count === 1 ? "transaction" : "transactions"}
      </p>
      <ul className="max-h-40 overflow-y-auto text-[13px] text-warm-600">
        {data.transactions.map((t) => (
          <li key={t.id} className="flex justify-between gap-3 py-1">
            <span className="min-w-0 truncate">{t.categoryName}</span>
            <span className="shrink-0 tabular-nums">{money(t.amount)}</span>
          </li>
        ))}
        {count > 1 && (
          <li className="mt-1 flex justify-between gap-3 border-t border-cream-200 pt-2 font-semibold">
            <span>Receipt total</span>
            <span className="shrink-0 tabular-nums">{money(data.total)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
