"use client";

import { CategoryIcon } from "@/components/ui/icon-map";
import { TransactionLabelPills } from "@/components/transactions/transaction-label-pills";
import { TransactionRowBadges } from "@/components/transactions/transaction-row-badges";
import { TransactionSelectionCheckbox } from "@/components/transactions/transaction-selection-checkbox";
import { useLongPress } from "@/hooks/use-long-press";
import { formatTime } from "@/lib/transaction-helpers";
import { cn, formatCurrency } from "@/lib/utils";
import type { TransactionWithCategory } from "@/types";

const noop = () => {};

interface TransactionListRowProps {
  tx: TransactionWithCategory;
  isSelected?: boolean;
  /**
   * True while the list is selecting. Below `sm` this is what reveals the checkbox and turns a
   * tap into a toggle; at `sm` and up the checkbox is always shown.
   */
  selectMode?: boolean;
  highlighted: boolean;
  hideAmounts: boolean;
  currency: string;
  timezoneOffset: number;
  creditCardsEnabled: boolean;
  receiptPhotosEnabled: boolean;
  /**
   * Selects or deselects this row. Leave it out for a list with nothing to select, such as the
   * dashboard's recent rows: the row then has no checkbox and no long-press, and a tap opens it.
   */
  onToggle?: () => void;
  onOpen: () => void;
  /** Touch-and-hold: the page enters select mode and selects this row. */
  onLongPress?: () => void;
  labelRemoval: {
    onRemove: (transactionLabelId: string, labelId: string) => void;
    removingLabelId: string | null;
    disabled: boolean;
  };
}

/**
 * One row of the transactions ledger.
 *
 * Phones and desktop differ only in CSS (`sm:`), so the server and the first client render agree.
 * Below `sm` a 390px screen left the description about 133px once a 44px checkbox column, the
 * icon and the amount were paid for, so there the checkbox waits for select mode, the badges
 * shrink to icons on the category line, and only the first label shows.
 */
export function TransactionListRow({
  tx,
  isSelected = false,
  selectMode = false,
  highlighted,
  hideAmounts,
  currency,
  timezoneOffset,
  creditCardsEnabled,
  receiptPhotosEnabled,
  onToggle,
  onOpen,
  onLongPress,
  labelRemoval,
}: TransactionListRowProps) {
  const selectable = onToggle !== undefined;
  // Called unconditionally, as a hook must be; its handlers are only attached when selectable.
  const { handlers, consumeClick } = useLongPress(onLongPress ?? noop);
  const badgeProps = {
    receiptGroupId: tx.receiptGroupId,
    billId: tx.billId,
    createdVia: tx.createdVia,
    creditAccount: creditCardsEnabled ? tx.creditAccount : null,
    receiptPhotoId: receiptPhotosEnabled ? tx.receiptPhotoId : null,
  };

  return (
    <div
      data-transaction-id={tx.id}
      {...(selectable ? handlers : {})}
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors group cursor-pointer sm:px-5",
        // A held finger must read as "select this", not as the start of a text selection.
        selectable && "select-none [-webkit-touch-callout:none] sm:select-auto",
        highlighted && "bg-amber-light/40 ring-1 ring-amber/40",
        isSelected ? "bg-amber-light/20" : "hover:bg-cream-50/80",
      )}
      onClick={() => {
        if (selectable && consumeClick()) return;
        if (selectable && selectMode) onToggle();
        else onOpen();
      }}
    >
      {/* A wrapper rather than a class on the checkbox: `cn` does not merge, so `hidden` beside
          its own `inline-flex` would be decided by stylesheet order, not by intent. */}
      {/* Stops pointerdown here so holding the checkbox never starts the row's long-press: the
          label already stops the click, so the release would toggle the row straight back. */}
      {selectable && (
        <span
          data-row-checkbox
          className={selectMode ? "contents" : "hidden sm:contents"}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <TransactionSelectionCheckbox
            label={`Select ${tx.description || tx.category.name} transaction`}
            state={isSelected ? "all" : "none"}
            onChange={onToggle}
            className="-my-2 -ml-3"
          />
        </span>
      )}

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

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-warm-600 truncate">{tx.description}</p>
          <span className="hidden sm:contents">
            <TransactionRowBadges {...badgeProps} />
          </span>
        </div>
        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
          <span className="contents sm:hidden">
            <TransactionRowBadges {...badgeProps} variant="icon" />
          </span>
          <p className="min-w-0 text-xs text-warm-300 truncate">{tx.category.name}</p>
          {tx.labels && tx.labels.length > 0 && (
            <TransactionLabelPills
              labels={tx.labels}
              maxVisible={3}
              collapseOnPhone
              // In select mode a pill tap must reach the row and toggle it: with a remove
              // handler the pill stops the click to reveal its X instead.
              onRemove={selectMode ? undefined : labelRemoval.onRemove}
              removingLabelId={labelRemoval.removingLabelId}
              removeDisabled={labelRemoval.disabled}
            />
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        <p
          className={cn(
            "text-sm font-display font-semibold tabular-nums",
            tx.type === "INCOME" ? "text-income" : "text-expense",
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
