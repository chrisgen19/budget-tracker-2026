export interface LabelShare {
  name: string;
  amount: number;
  percentage: number;
  transactionCount: number;
}

/** How many labels are listed before the rest are summarised into one line. */
export const LABEL_SHOW = 10;

/**
 * Render spending split across labels.
 *
 * The listed rows have to reconcile with the total printed under them. An earlier version listed
 * the top ten, printed the whole month's total, and asserted that the percentages "add to 100%",
 * which is false for anyone with more than ten labels in use and leaves the difference
 * unaccounted for. Whatever is cut is now summarised into one line, so the visible figures still
 * add up, and the 100% claim is only made when nothing was omitted.
 */
export const renderLabelBreakdown = (
  month: string,
  labels: LabelShare[],
  total: number,
  money: (n: number) => string
): string => {
  if (labels.length === 0) return `No labelled spending in ${month}.`;

  const shown = labels.slice(0, LABEL_SHOW);
  const rest = labels.slice(LABEL_SHOW);

  let msg = `\u{1F3F7}️ *Spending by label, ${month}*\n\n`;
  for (const l of shown) {
    msg += `• *${l.name}*: ${money(l.amount)} (${l.percentage.toFixed(0)}%, ${l.transactionCount} txn)\n`;
  }

  if (rest.length > 0) {
    const amount = rest.reduce((sum, l) => sum + l.amount, 0);
    const percentage = rest.reduce((sum, l) => sum + l.percentage, 0);
    msg += `• _${rest.length} other label${rest.length === 1 ? "" : "s"}_: ${money(amount)} (${percentage.toFixed(0)}%)\n`;
  }

  msg += `\nTotal: *${money(total)}*`;

  // The app divides a transaction's amount evenly across its labels, which is what makes these
  // shares sum to the month's spending. Worth saying, because the search handler counts each
  // transaction in full and the two figures would otherwise look like a contradiction.
  msg += `\n\n_A transaction with two labels counts half to each${
    rest.length > 0 ? "" : ", so these add to 100%"
  }._`;

  return msg;
};
