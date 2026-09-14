"use client";

import { AlertTriangle, RotateCw, X } from "lucide-react";
import { useUser } from "@/components/user-provider";
import { purchasesTotal } from "@/components/credit-accounts/card-purchases-form";
import { formatCurrency } from "@/lib/utils";

interface UnconfirmedPurchasesProps {
  purchases: readonly { amount: number }[];
  retrying: boolean;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * Shown in place of the purchases form when a save may or may not have landed. Only a retry of the
 * same rows is offered, since editing them now could lose the edits or write the purchases twice.
 */
export function UnconfirmedPurchases({ purchases, retrying, onRetry, onClose }: UnconfirmedPurchasesProps) {
  const { user } = useUser();
  const count = `${purchases.length} ${purchases.length === 1 ? "purchase" : "purchases"}`;

  return (
    <div className="space-y-4">
      <div role="alert" className="flex gap-3 rounded-xl border border-expense/20 bg-expense-light/40 p-4 text-sm text-warm-600">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-expense" />
        <div className="space-y-1">
          <p className="font-medium text-warm-700">
            Couldn&apos;t confirm {count} ({formatCurrency(purchasesTotal(purchases), user.currency)}) were saved
          </p>
          <p>
            Retry sends exactly the same purchases, so they can&apos;t be added twice. To change one, retry
            first, then edit it once it&apos;s saved.
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cream-300 text-sm font-medium text-warm-500 transition-colors hover:bg-cream-100"
        >
          <X className="h-4 w-4" />
          Close
        </button>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="flex-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber text-sm font-medium text-white shadow-soft transition-colors hover:bg-amber-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {retrying ? "Retrying…" : "Retry"}
        </button>
      </div>
    </div>
  );
}
