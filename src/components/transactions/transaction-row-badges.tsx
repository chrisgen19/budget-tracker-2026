import { CalendarClock, Receipt, Sparkles } from "lucide-react";
import type { TransactionSource } from "@prisma/client";

interface TransactionRowBadgesProps {
  /** Set when the row came from a scanned receipt that was itemised across categories. */
  receiptGroupId?: string | null;
  /** Set when the row was created by paying a recurring bill. */
  billId?: string | null;
  /** Where the row was created, from `transactions.created_via`. */
  createdVia?: TransactionSource;
}

/**
 * The small markers that sit beside a transaction's description.
 *
 * Extracted from the transactions page so they can be tested: the page renders them inline, and
 * exercising them there would mean mounting the whole route with its providers, router and query
 * client to assert on one span.
 *
 * Provenance is icon-only while the other two carry text. A row is already crowded on a narrow
 * screen, and unlike "Itemized" and "Bill" this one is answering a question most rows do not
 * raise, so it earns less space. The meaning lives in the accessible name rather than the glyph.
 */
export function TransactionRowBadges({
  receiptGroupId,
  billId,
  createdVia,
}: TransactionRowBadgesProps) {
  return (
    <>
      {receiptGroupId && (
        <span className="shrink-0 inline-flex items-center gap-0.5 bg-amber-light/60 text-amber-dark text-[10px] font-medium px-1.5 py-0.5 rounded">
          <Receipt className="w-2.5 h-2.5" />
          Itemized
        </span>
      )}
      {billId && (
        <span className="shrink-0 inline-flex items-center gap-0.5 bg-income-light text-income text-[10px] font-medium px-1.5 py-0.5 rounded">
          <CalendarClock className="w-2.5 h-2.5" />
          Bill
        </span>
      )}
      {createdVia === "MCP" && (
        <span
          title="Added by Claude"
          aria-label="Added by Claude"
          role="img"
          className="shrink-0 inline-flex items-center text-amber-dark"
        >
          <Sparkles className="w-3 h-3" />
        </span>
      )}
    </>
  );
}
