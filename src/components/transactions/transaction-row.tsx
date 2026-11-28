import type { ReactNode } from "react";
import { cn, formatCurrency } from "@/lib/utils";
import { formatTime } from "@/lib/transaction-helpers";
import { CategoryIcon } from "@/components/ui/icon-map";
import { TransactionLabelPills } from "@/components/transactions/transaction-label-pills";
import { TransactionRowBadges } from "@/components/transactions/transaction-row-badges";
import type { TransactionWithCategory } from "@/types";

interface TransactionRowProps {
  tx: TransactionWithCategory;
  currency: string;
  hideAmounts: boolean;
  timezoneOffset: number;
  showCreditAccount: boolean;
  showReceiptPhoto: boolean;
  onSelect: () => void;
  onRemoveLabel?: (labelId: string) => void;
  removingLabelId?: string | null;
  removeLabelDisabled?: boolean;
  /** Rendered before the category icon, e.g. the selection checkbox. */
  leading?: ReactNode;
  selected?: boolean;
  highlighted?: boolean;
  /** Defaults to 3. */
  maxLabels?: number;
}

/**
 * One transaction row, shared by the transactions page and the dashboard.
 *
 * Moved verbatim out of the transactions page, so the markup and classes stay identical there.
 * `data-transaction-id` is what the page's highlight scrolling looks up.
 */
export function TransactionRow({
  tx,
  currency,
  hideAmounts,
  timezoneOffset,
  showCreditAccount,
  showReceiptPhoto,
  onSelect,
  onRemoveLabel,
  removingLabelId,
  removeLabelDisabled,
  leading,
  selected,
  highlighted,
  maxLabels = 3,
}: TransactionRowProps) {
  return (
    <div
      data-transaction-id={tx.id}
      className={cn(
        "flex items-center gap-3 px-5 py-3 transition-colors group cursor-pointer",
        highlighted && "bg-amber-light/40 ring-1 ring-amber/40",
        selected ? "bg-amber-light/20" : "hover:bg-cream-50/80"
      )}
      onClick={onSelect}
    >
      {leading}

      {/* Category icon */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: tx.category.color + "18" }}
      >
        <CategoryIcon
          name={tx.category.icon}
          className="w-4 h-4"
          style={{ color: tx.category.color }}
        />
      </div>

      {/* Description + category */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-warm-600 truncate">{tx.description}</p>
          <TransactionRowBadges
            receiptGroupId={tx.receiptGroupId}
            billId={tx.billId}
            createdVia={tx.createdVia}
            creditAccount={showCreditAccount ? tx.creditAccount : null}
            receiptPhotoId={showReceiptPhoto ? tx.receiptPhotoId : null}
          />
        </div>
        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
          <p className="text-xs text-warm-300 truncate">{tx.category.name}</p>
          {tx.labels && tx.labels.length > 0 && (
            <TransactionLabelPills
              labels={tx.labels}
              maxVisible={maxLabels}
              onRemove={
                onRemoveLabel ? (_tlId, labelId) => onRemoveLabel(labelId) : undefined
              }
              removingLabelId={removingLabelId}
              removeDisabled={removeLabelDisabled}
            />
          )}
        </div>
      </div>

      {/* Amount + time */}
      <div className="text-right shrink-0">
        <p
          className={cn(
            "text-sm font-display font-semibold tabular-nums",
            tx.type === "INCOME" ? "text-income" : "text-expense"
          )}
        >
          {hideAmounts
            ? "••••"
            : `${tx.type === "INCOME" ? "+" : "-"}${formatCurrency(tx.amount, currency)}`}
        </p>
        <p className="text-[11px] text-warm-300 tabular-nums">
          {formatTime(tx.date, timezoneOffset)}
        </p>
      </div>
    </div>
  );
}
