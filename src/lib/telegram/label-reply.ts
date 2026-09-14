export interface LabelShare {
  name: string;
  amount: number;
  percentage: number;
  transactionCount: number;
}

/** How many labels are listed before the rest are summarised into one line. */
export const LABEL_SHOW = 10;

/**
 * Render spending by label.
 *
 * Whatever is cut past `LABEL_SHOW` is summarised into one line rather than dropped. A transaction
 * with several labels counts in full under each (see `buildLabelBreakdown`), so when labels overlap
 * the figures add to more than the total, and the reply says so instead of leaving it to look like
 * an error.
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

  // Half a centavo of slack, so floating-point sums of an exact partition never read as overlap.
  const listed = labels.reduce((sum, l) => sum + l.amount, 0);
  if (listed > total + 0.005) {
    msg += `\n\n_A transaction with more than one label counts in full under each, so these add to more than the total._`;
  }

  return msg;
};
