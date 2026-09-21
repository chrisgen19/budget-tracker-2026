"use client";

import { AlertTriangle, RotateCw, Trash2, X } from "lucide-react";
import { useUser } from "@/components/user-provider";
import { purchasesTotal } from "@/components/credit-accounts/card-purchases-form";
import { formatCurrency } from "@/lib/utils";

interface UnconfirmedPurchasesProps {
  purchases: readonly { amount: number }[];
  retrying: boolean;
  onRetry: () => void;
  onDiscard: () => void;
  onClose: () => void;
  /** What these rows are called. Interest and fees go through the same batch writer as purchases. */
  noun?: { singular: string; plural: string };
}

/**
 * Shown in place of the purchases form when a save may or may not have landed. Retry sends the same
 * rows, which is always safe. Discard is the way out when retrying keeps failing, and the card's list
 * behind this modal has been refreshed so it can be checked first.
 */
export function UnconfirmedPurchases({
  purchases,
  retrying,
  onRetry,
  onDiscard,
  onClose,
  noun = { singular: "purchase", plural: "purchases" },
}: UnconfirmedPurchasesProps) {
  const { user } = useUser();
  const count = `${purchases.length} ${purchases.length === 1 ? noun.singular : noun.plural}`;

  return (
    <div className="space-y-4">
      <div role="alert" className="flex gap-3 rounded-xl border border-expense/20 bg-expense-light/40 p-4 text-sm text-warm-600">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-expense" />
        <div className="space-y-1">
          <p className="font-medium text-warm-700">
            Couldn&apos;t confirm {count} ({formatCurrency(purchasesTotal(purchases), user.currency)}) were saved
          </p>
          <p>
            Retry sends exactly the same {noun.plural}, so they can&apos;t be added twice. To change one, retry
            first, then edit it once it&apos;s saved.
          </p>
          <p>
            If retrying keeps failing, close this and check the card&apos;s list. Listed there means they were
            saved, so discard these. Not listed means they weren&apos;t, so discard and enter them again.
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

      <button
        type="button"
        onClick={onDiscard}
        disabled={retrying}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 text-sm text-warm-400 transition-colors hover:text-expense disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
        Discard these {noun.plural}
      </button>
    </div>
  );
}
