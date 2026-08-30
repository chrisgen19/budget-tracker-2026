/**
 * Read an explicit label directive out of free text.
 *
 * "label it in pickleball" reached Gemini inside a photo caption and had nowhere to go: nothing
 * on the receipt path knew what a label was, so the request was silently dropped and the
 * transaction was saved unlabelled. This is the parser that gives it somewhere to go.
 *
 * Deliberately local rather than another model call. It has to work with no `GEMINI_API_KEY`,
 * the same way `commands.ts` resolves obvious phrasings before Gemini is consulted at all, and
 * paying a request to recognise the word "label" is slow for something a regex settles.
 *
 * Only an *explicit* directive counts. A bare mention of a label name does not auto-apply one:
 * "Pickleball court fee" is a description, and labelling on it would tag "lunch with the
 * pickleball crew" as a game. The cost of the two mistakes is not symmetric — a missing label is
 * visible in the review and fixed in the app, a wrong one quietly moves money in the label
 * breakdown, which splits an amount across whatever labels a transaction carries.
 */

export interface BotLabel {
  id: string;
  name: string;
}

export interface LabelDirective {
  /** Ids resolved against the user's real labels, deduped, in the order they were named. */
  ids: string[];
  /** Their canonical names, for the review line. */
  names: string[];
  /**
   * Names the user asked for that match no label they own.
   *
   * Reported rather than discarded. A silently dropped label is the exact bug this module
   * exists to fix, and the bot cannot create one for them: `create_transactions` is its only
   * write tool, which is what stops a leaked token from rewriting anything.
   */
  unresolved: string[];
  /** The text with the recognised directive removed, for use as a description. */
  rest: string;
}

/** A label name is short. Anything longer is prose that followed the keyword, not a name. */
const MAX_NAME_CHARS = 40;
/** And it is few words. "for the shoes" is what follows "price tag", not a label nobody has. */
const MAX_NAME_WORDS = 3;
/** How many unmatched names are worth naming back. Beyond this it is not a directive. */
const MAX_UNRESOLVED = 3;

/** The directive keyword, with its optional colon. `labelled`/`tagging` are prose and excluded. */
const KEYWORD = /\b(labels?|tags?)\b\s*:?\s*/giu;

/** Words that sit between the keyword and the name: "label **it in** pickleball". */
const FILLER = /^\s*(?:it|this|that|them|these|those|as|in|to|under|with|the)\b\s*/iu;

/** What separates two names in a list: "label it pickleball and sports". */
const CONNECTOR = /^\s*(?:,|;|&|and\b|plus\b)\s*/iu;

/** Ends the directive's reach. A name never spans one of these. */
const CLAUSE_END = /[,;.\n]/u;

/** `#pickleball`. Two characters minimum and a leading letter, so "#1" is not a label. */
const HASHTAG = /#(\p{L}[\p{L}\p{N}_-]+)/giu;

/** Whether `name` sits at `at` as a whole word — "work" must not match inside "workout". */
const matchesAt = (text: string, at: number, name: string): boolean => {
  if (!text.toLowerCase().startsWith(name.toLowerCase(), at)) return false;
  const after = text[at + name.length];
  return after === undefined || !/[\p{L}\p{N}]/u.test(after);
};

/**
 * The longest label name sitting at `at`.
 *
 * Longest first, so "label it work lunch" resolves to `Work Lunch` rather than stopping at
 * `Work` and leaving "lunch" behind as an unmatched name.
 */
const labelAt = (text: string, at: number, byLength: BotLabel[]): BotLabel | null =>
  byLength.find((l) => matchesAt(text, at, l.name)) ?? null;

interface Span {
  start: number;
  end: number;
}

/** Tidy what removing a directive leaves behind: doubled or dangling separators, stray space. */
const tidy = (text: string): string =>
  text
    .replace(/\s+/gu, " ")
    .replace(/([,;])(?:\s*[,;])+/gu, "$1")
    .replace(/^[\s,;&-]+/u, "")
    .replace(/[\s,;&-]+$/u, "")
    .trim();

/**
 * Whether a message is worth parsing for a label at all.
 *
 * A cheap pre-check, so the shorthand logger — the fast path that exists precisely to answer
 * "100 breakfast" without a network round trip — only pays for `get_label_list` on a message
 * that plausibly names one.
 */
export const mentionsLabel = (text: string): boolean => /\b(?:labels?|tags?)\b|#\p{L}/iu.test(text);

/**
 * Read the labels a message explicitly asks for.
 *
 * Resolution is exact and case-insensitive, never fuzzy, for the same reason `findByName` in
 * `search-intent.ts` is: a near miss there filters on the wrong label and "no transactions
 * found" reads like an answer. Here a near miss *writes* the wrong label, which is worse and
 * outlives the conversation.
 */
export const readLabelDirective = (text: string, labels: BotLabel[]): LabelDirective => {
  const ids: string[] = [];
  const names: string[] = [];
  const unresolved: string[] = [];
  const spans: Span[] = [];

  const byLength = [...labels].sort((a, b) => b.name.length - a.name.length);

  const take = (label: BotLabel) => {
    if (ids.includes(label.id)) return;
    ids.push(label.id);
    names.push(label.name);
  };

  const takeUnresolved = (raw: string) => {
    const name = raw.trim().replace(/^["']|["']$/gu, "");
    if (!name || name.length > MAX_NAME_CHARS) return;
    // A name starts with a letter and is a few words at most. "150" is the amount on a price
    // tag, not a label the user was denied.
    if (!/^\p{L}/u.test(name)) return;
    if (name.split(/\s+/u).length > MAX_NAME_WORDS) return;
    if (unresolved.length >= MAX_UNRESOLVED) return;
    if (unresolved.some((u) => u.toLowerCase() === name.toLowerCase())) return;
    unresolved.push(name);
  };

  // Hashtags first, and anywhere in the text: "#pickleball" is a directive wherever it lands.
  for (const match of text.matchAll(HASHTAG)) {
    const raw = match[1];
    // A hyphen or underscore stands in for a space, since neither can be typed inside a hashtag.
    const spaced = raw.replace(/[-_]/gu, " ");
    const found = labels.find(
      (l) => l.name.toLowerCase() === raw.toLowerCase() || l.name.toLowerCase() === spaced.toLowerCase()
    );
    if (found) take(found);
    else takeUnresolved(spaced);
    spans.push({ start: match.index, end: match.index + match[0].length });
  }

  for (const match of text.matchAll(KEYWORD)) {
    const start = match.index;
    let cursor = start + match[0].length;

    // "label it in pickleball" — consume each filler word in turn. A colon or a filler word is
    // also what makes this a directive rather than the noun: see the unresolved branch below.
    let marked = match[0].includes(":");
    for (;;) {
      const filler = FILLER.exec(text.slice(cursor));
      if (!filler) break;
      cursor += filler[0].length;
      marked = true;
    }

    // Two cursors, because a connector is only part of the directive if a name follows it.
    // "label it pickleball, category fun" reaches the comma and finds no label after it, and
    // swallowing the separator anyway would run the two clauses of the caption together.
    let settled = -1;
    let probe = cursor;
    for (;;) {
      const label = labelAt(text, probe, byLength);
      if (!label) break;
      take(label);
      probe += label.name.length;
      settled = probe;

      const connector = CONNECTOR.exec(text.slice(probe));
      if (!connector) break;
      probe += connector[0].length;
    }

    if (settled >= 0) {
      spans.push({ start, end: settled });
      continue;
    }

    // The keyword named something this user does not have. Say so rather than dropping it —
    // but do not touch the text, since deleting words nobody understood is how a description
    // loses the half that was fine. Bounded to one clause, and only where a colon or a filler
    // word marked this as an instruction: "price tag for the shoes" is a noun, and reporting
    // "for the shoes" back as a missing label is noise on a message that asked for nothing.
    // Resolving needs no such marker, because an exact hit on a real label cannot be noise.
    if (!marked) continue;
    const tail = text.slice(cursor);
    const stop = CLAUSE_END.exec(tail);
    takeUnresolved(stop ? tail.slice(0, stop.index) : tail);
  }

  // Cut from the end so earlier offsets stay valid.
  let rest = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    rest = rest.slice(0, span.start) + rest.slice(span.end);
  }

  return { ids, names, unresolved, rest: tidy(rest) };
};

/**
 * The lines a reply adds for the labels it read, and for the ones it could not.
 *
 * Both halves are said out loud on the same principle as the existing "I used your caption as a
 * hint" and the repaired-receipt-year notice: an inference the user cannot see is one they
 * cannot undo, and this is the moment they can still correct it. The unmatched half matters
 * more — a label that silently went nowhere is the bug this module was written for, and the bot
 * cannot create one to fix it, since `create_transactions` is its only write.
 *
 * @param labelsReadable Whether the label list was actually read. False makes the difference
 * between two states an empty list cannot tell apart: the user has no such label, or the bot
 * could not find out. Telling someone to create a label they already have is a worse answer than
 * admitting the lookup failed, and it sends them to the wrong place to fix it — the cause is a
 * token minted without `labels:read`, not a missing label.
 */
export const renderLabelNotice = (
  directive: Pick<LabelDirective, "names" | "unresolved">,
  labelsReadable = true
): string => {
  let notice = "";
  if (directive.names.length > 0) {
    notice += `\n\u{1F3F7}\uFE0F *Labels:* ${directive.names.join(", ")}\n`;
  }
  if (directive.unresolved.length > 0) {
    const one = directive.unresolved.length === 1;
    const named = directive.unresolved.map((n) => `*${n}*`).join(", ");
    notice += labelsReadable
      ? `\n\u26a0\ufe0f You don't have ${one ? "a label" : "labels"} called ${named}, so I left ` +
        `${one ? "it" : "them"} off. Create ${one ? "it" : "them"} in the app and ` +
        `${one ? "it" : "they"}'ll stick next time.\n`
      : `\n\u26a0\ufe0f I couldn't read your labels just now, so I left ${named} off — ` +
        `${one ? "it" : "they"} may well exist. If this keeps happening, mint a bot token with ` +
        `the labels:read scope in Profile > MCP Access.\n`;
  }
  return notice;
};
