/**
 * The confirmation for a write, rendered away from the bot's I/O.
 *
 * Extracted for the same reason `label-reply.ts` and `receipt-reply.ts` are: this is pure text
 * assembly with real branching in it, and the branch that matters is the one that lists *every*
 * row. It used to render `transactions[0]` alone, which was harmless only while a message could
 * never write more than one row. Now that `250 grab, 180 lunch` writes two, showing the first and
 * silently dropping the second would report the same half-success #204 was about.
 */

/** What `create_transactions` returns; see `renderCreated` in the MCP server. */
export interface CreatedBatch {
  created: number;
  replayed: boolean;
  transactions: {
    id: string;
    amount: number;
    description: string;
    type: string;
    /** The user's own calendar day, already resolved server-side. */
    date: string;
    categoryName: string;
    /** Label names, including any the user's auto-apply schedules added. */
    labels: string[];
  }[];
}

/**
 * Confirm what was written, listing every row.
 *
 * It used to render `transactions[0]` and nothing else, which was harmless only while one message
 * could never write more than one row. Now that `250 grab, 180 lunch` writes two, showing the
 * first and silently omitting the second would report exactly the half-success that #204 was
 * about — the user would still have no way to see that both landed.
 *
 * The single-row form is kept verbatim, since it is what almost every message produces and its
 * labelled layout reads better than a list of one.
 */
export const renderCreated = (
  result: CreatedBatch,
  money: (n: number) => string
): string => {
  // A replay wrote nothing: the same update was redelivered after a crash, so saying "logged"
  // would imply rows that do not exist.
  const heading = result.replayed
    ? `\u2705 *Already logged* (no duplicate created)\n\n`
    : `\u2705 *Transaction Logged!*\n\n`;

  if (result.transactions.length === 1) {
    const tx = result.transactions[0];
    const labels = tx.labels.join(", ");
    let reply = heading;
    reply += `\ud83d\udcdd *Description:* ${tx.description}\n`;
    reply += `\ud83d\udcb0 *Amount:* ${money(tx.amount)}\n`;
    reply += `\ud83d\udcc1 *Category:* ${tx.categoryName}\n`;
    reply += `\ud83d\udcc5 *Date:* ${tx.date}\n`;
    if (labels) reply += `\ud83c\udff7\ufe0f *Labels:* ${labels}\n`;
    return reply;
  }

  const plural = result.replayed
    ? `\u2705 *Already logged* (no duplicates created)\n\n`
    : `\u2705 *${result.transactions.length} transactions logged!*\n\n`;

  let reply = plural;
  for (const tx of result.transactions) {
    const icon = tx.type === "INCOME" ? "\u2795" : "\u2796";
    const labels = tx.labels.join(", ");
    reply += `${icon} *${money(tx.amount)}* - ${tx.description}\n`;
    reply += `   \ud83d\udcc1 ${tx.categoryName} | \ud83d\udcc5 ${tx.date}`;
    reply += labels ? ` | \ud83c\udff7\ufe0f ${labels}\n` : `\n`;
  }

  // Stated because the rows are individually small and the number is what gets checked against a
  // receipt or a bank app.
  const total = result.transactions.reduce(
    (sum, tx) => sum + (tx.type === "INCOME" ? -tx.amount : tx.amount),
    0
  );
  if (total > 0) reply += `\n\ud83d\udcb8 *Total spent:* ${money(total)}\n`;

  return reply;
};
