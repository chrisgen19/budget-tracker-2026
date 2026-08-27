export interface RenderedItem {
  name: string;
  amount: number;
}

export interface ReceiptReply {
  heading: string;
  subheading?: string;
  items: RenderedItem[];
  /** How many matched in total, which may exceed the items listed. */
  itemCount: number;
  total: number;
  /**
   * Whether the total was computed from a capped page rather than every match.
   *
   * Only true for the locally filtered merchant fallback. `get_receipt_items` computes its own
   * `itemCount` and `totalAmount` over the full match set and slices only the returned list, so a
   * direct query's total is complete even when `truncated` is set. Marking that one partial made
   * a correct financial figure look untrustworthy, which is its own kind of wrong answer.
   */
  partial: boolean;
}

/** How many line items a reply lists before summarising. */
export const RECEIPT_ITEM_SHOW = 15;

/** One layout for every receipt-item reply, so the caveats cannot drift between them. */
export const renderReceiptItems = (r: ReceiptReply, money: (n: number) => string): string => {
  let msg = `\u{1F9FE} *${r.heading}*\n`;
  if (r.subheading) msg += `_${r.subheading}_\n`;
  msg += `\n`;

  for (const i of r.items.slice(0, RECEIPT_ITEM_SHOW)) {
    msg += `• ${i.name} · *${money(i.amount)}*\n`;
  }
  if (r.items.length > RECEIPT_ITEM_SHOW) {
    msg += `\n_Showing ${RECEIPT_ITEM_SHOW} of ${r.itemCount}._`;
  }

  msg += `\n\nTotal: *${money(r.total)}* across ${r.itemCount} item${r.itemCount === 1 ? "" : "s"}`;
  if (r.partial) {
    msg += `\n_Counted from the most recent lines only; older receipts were not searched._`;
  }
  return msg;
};
