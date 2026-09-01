/**
 * Splitting one message into the several transactions it actually describes.
 *
 * The shorthand path used a single greedy regex - an amount, then "everything after it is the
 * description" - so `250 grab, 180 lunch` logged one row of 250 described as "grab, 180 lunch",
 * and reported it as a clean success (#204). The second amount was not rejected, it was
 * *swallowed*, which is the worst shape for a bug about money: nothing to notice and nothing to
 * correct until the category breakdown looks wrong weeks later.
 *
 * It matters more now than it did. The evening prompt asks "fare today? lunch?", and the natural
 * reply to a question with two halves is a message with two halves.
 */

export interface ShorthandEntry {
  amount: number;
  description: string;
  isIncome: boolean;
}

/**
 * Where a new entry begins: a separator, then an amount, then a description.
 *
 * The separator is required, and that is the whole conservatism of this parser. Splitting on a
 * bare space before a number would tear `1500 internet bill 2026` and `250 grab 2 way` in half,
 * and a wrongly split row is worse than an unsplit one - it invents a transaction rather than
 * mis-describing one. A comma, a semicolon, a newline or the word "and" are deliberate enough to
 * act on; whitespace is not.
 *
 * `and` only counts when an amount follows it, so `250 lunch and coffee` stays one row while
 * `250 grab and 180 lunch` becomes two.
 */
const ENTRY_START = /(?:^|[,;\n]|\s+and\s+)\s*(\+?)(\d+(?:\.\d+)?)\s+(?=\S)/g;

/** Separators left dangling on the end of a description once the next entry is split off. */
const TRAILING_SEPARATOR = /[\s,;]+$/;

/**
 * Every transaction a shorthand message describes, in the order written.
 *
 * Returns an empty array when the text is not shorthand at all, so the caller falls through to
 * the classifier exactly as it did before. A single entry parses identically to the old regex,
 * which is deliberate: the common case must not change behaviour.
 *
 * A clause without its own leading amount is *not* a new entry, so it stays part of the
 * description before it. That is what keeps `1500 groceries, milk and eggs` whole, and what keeps
 * a trailing label directive (`250 pickleball, label it work`) attached to the entry it follows
 * rather than becoming a transaction of its own.
 */
export const parseShorthandEntries = (text: string): ShorthandEntry[] => {
  const trimmed = text.trim();
  ENTRY_START.lastIndex = 0;

  const starts: { matchStart: number; descStart: number; sign: string; amount: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = ENTRY_START.exec(trimmed)) !== null) {
    starts.push({
      matchStart: match.index,
      descStart: match.index + match[0].length,
      sign: match[1],
      amount: match[2],
    });
    // A zero-length match cannot happen here (the pattern needs at least a digit and a space),
    // but the guard keeps a future edit from turning this into an infinite loop.
    if (match.index === ENTRY_START.lastIndex) ENTRY_START.lastIndex += 1;
  }

  // The first entry has to start at the beginning. Anything else means the message opens with
  // prose, which is the classifier's job and not this one's: "spent 350 on lunch" must not be
  // read as an amount with the word "spent" mysteriously dropped.
  if (starts.length === 0 || starts[0].matchStart !== 0) return [];

  const entries: ShorthandEntry[] = [];
  for (const [i, start] of starts.entries()) {
    const end = starts[i + 1]?.matchStart ?? trimmed.length;
    const description = trimmed.slice(start.descStart, end).replace(TRAILING_SEPARATOR, "").trim();
    const amount = parseFloat(start.amount);

    // A clause with no description left is not a transaction anybody can read back later. Rather
    // than logging a bare amount, the whole message falls through so the classifier can try.
    if (!description || !(amount > 0)) return [];

    entries.push({ amount, description, isIncome: start.sign === "+" });
  }

  return entries;
};
