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
  /**
   * "EXPENSE" | "INCOME" | "BOTH", when the caller fetched it.
   *
   * Optional because `findByName` and the search path only ever need id and name. Where it is
   * present, a label that cannot apply to the transaction being written is reported rather than
   * applied: `createTransactionBatch` type-filters explicit ids *silently*, so a review promising
   * an income-only label on a receipt would show it and then quietly not write it.
   */
  applicableTo?: string;
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
  /**
   * Real labels the user named that cannot apply to this transaction's type.
   *
   * Kept apart from `unresolved` because the two need opposite advice: one says create it, the
   * other says it exists but not for this kind of transaction. Telling someone to create a label
   * they are looking at in the app is the same wrong-reason error as reporting an unreadable list
   * as a missing one.
   */
  incompatible: string[];
  /**
   * Names that could be the start of more than one label, with the labels they could mean.
   *
   * Reported rather than guessed at. Picking one would apply a label the user did not choose,
   * and a wrong label moves money in `getLabelBreakdown` — the mistake this module works hardest
   * to avoid. Naming the candidates lets them answer with the one they meant.
   */
  ambiguous: { name: string; candidates: string[] }[];
  /**
   * Whether a directive was actually recognised and cut out of `rest`.
   *
   * The question a caller really has is "is `rest` something the user left me, or just their
   * untouched reply?", and length alone cannot answer it. A bare unmarked directive is reported
   * but deliberately not removed, so `rest` is then the whole input and writing it back would
   * make "label badminton" the description of the purchase.
   */
  removedDirective: boolean;
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

/** Where one name in a list ends: a separator, or the end of the directive's clause. */
const SEGMENT_END = /[,;.\n]|\s+(?:and|plus)\b|\s*&/iu;

/**
 * Where the directive's clause ends.
 *
 * Unlike `SEGMENT_END` this ignores "and", because a label name may contain one — "With Mom and
 * Dad Budget". Splitting on it first turned that name into "mom" and "dad", two labels nobody has.
 */
const CLAUSE_END = /[,;.\n]/u;

/** The whole clause at `at`, without splitting on a conjunction. */
const clauseAt = (text: string, at: number): string => {
  const tail = text.slice(at);
  const end = CLAUSE_END.exec(tail);
  return end ? tail.slice(0, end.index) : tail;
};

/** The raw text of the next name-shaped segment at `at`, up to its boundary. */
const segmentAt = (text: string, at: number): string => {
  const tail = text.slice(at);
  const end = SEGMENT_END.exec(tail);
  return end ? tail.slice(0, end.index) : tail;
};

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

/**
 * A label the name is the start of, when exactly one qualifies.
 *
 * Exact matching alone was too strict for how labels are actually named. Someone whose labels are
 * "Work Budget" and "Pickleball Budget" says "label it work", not "label it Work Budget", and an
 * exact-only rule answers every one of those with "you don't have a label called work" — true to
 * the letter and useless.
 *
 * The relaxation is deliberately not fuzzy: no edit distance, no similarity score, nothing that
 * can match a name the user did not type. A whole-word prefix only, so "work" reaches "Work
 * Budget" but never "Workshop", and only when exactly one label qualifies. Two candidates are
 * reported as ambiguous rather than resolved, because guessing between them writes a label nobody
 * chose.
 */
type PrefixMatch =
  | { kind: "one"; label: BotLabel }
  | { kind: "many"; candidates: string[] }
  | { kind: "none" };

const resolveByPrefix = (needle: string, labels: BotLabel[]): PrefixMatch => {
  const n = needle.trim().toLowerCase();
  if (!n) return { kind: "none" };

  const hits = labels.filter((l) => {
    const name = l.name.toLowerCase();
    if (!name.startsWith(n)) return false;
    // The next character must end a word, or "work" would reach "Workshop".
    const after = name[n.length];
    return after === undefined || after === " ";
  });

  if (hits.length === 1) return { kind: "one", label: hits[0] };
  if (hits.length > 1) return { kind: "many", candidates: hits.map((l) => l.name) };
  return { kind: "none" };
};

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
 * Read the labels a message explicitly asks for.
 *
 * Resolution is exact and case-insensitive, never fuzzy, for the same reason `findByName` in
 * `search-intent.ts` is: a near miss there filters on the wrong label and "no transactions
 * found" reads like an answer. Here a near miss *writes* the wrong label, which is worse and
 * outlives the conversation.
 */
export const readLabelDirective = (
  text: string,
  labels: BotLabel[],
  /** The transaction type these labels are for, when known. Enables the compatibility check. */
  appliesTo?: "EXPENSE" | "INCOME"
): LabelDirective => {
  const ids: string[] = [];
  const names: string[] = [];
  const unresolved: string[] = [];
  const incompatible: string[] = [];
  const ambiguous: { name: string; candidates: string[] }[] = [];
  const spans: Span[] = [];

  const byLength = [...labels].sort((a, b) => b.name.length - a.name.length);

  const take = (label: BotLabel) => {
    const type = label.applicableTo;
    if (appliesTo && type && type !== "BOTH" && type !== appliesTo) {
      if (!incompatible.includes(label.name)) incompatible.push(label.name);
      return;
    }
    if (ids.includes(label.id)) return;
    ids.push(label.id);
    names.push(label.name);
  };

  /** A name starts with a letter and is a few words. "150" is a price, "for the shoes" is prose. */
  const looksLikeName = (raw: string): boolean => {
    const name = raw.trim();
    return (
      !!name &&
      name.length <= MAX_NAME_CHARS &&
      /^\p{L}/u.test(name) &&
      name.split(/\s+/u).length <= MAX_NAME_WORDS
    );
  };

  const takeAmbiguous = (name: string, candidates: string[]) => {
    if (ambiguous.some((a) => a.name.toLowerCase() === name.toLowerCase())) return;
    ambiguous.push({ name, candidates });
  };

  const takeUnresolved = (raw: string) => {
    const name = raw.trim().replace(/^["']|["']$/gu, "");
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
    if (found) {
      take(found);
    } else {
      // No `looksLikeName` gate here. That test exists to keep prose after the word "tag" from
      // being read as a name, and a hashtag is explicit by construction — the regex already
      // demands a leading letter. Applying it anyway dropped "#with-mom-and-dad" in silence for
      // being four words long, which is the exact failure this module was written to end.
      const prefix = resolveByPrefix(spaced, labels);
      if (prefix.kind === "one") take(prefix.label);
      else if (prefix.kind === "many") takeAmbiguous(spaced, prefix.candidates);
      else if (spaced.length <= MAX_NAME_CHARS) takeUnresolved(spaced);
    }
    spans.push({ start: match.index, end: match.index + match[0].length });
  }

  for (const match of text.matchAll(KEYWORD)) {
    const start = match.index;
    let cursor = start + match[0].length;

    // "label it in pickleball" — consume each filler word in turn. A colon or a filler word is
    // also what makes this an instruction rather than the noun, which both gates below use.
    let explicit = match[0].includes(":");
    for (;;) {
      // Stop where a label name begins. Several filler words are also the first word of a real
      // name — "with" opens "With Mom and Dad Budget" — and eating it left "mom and dad", which
      // then split on the conjunction into two labels nobody has.
      if (labelAt(text, cursor, byLength)) break;
      const ahead = clauseAt(text, cursor);
      if (
        ahead.trim().length <= MAX_NAME_CHARS &&
        resolveByPrefix(ahead, labels).kind === "one"
      ) {
        break;
      }

      const filler = FILLER.exec(text.slice(cursor));
      if (!filler) break;
      cursor += filler[0].length;
      explicit = true;
    }

    // A single-word tail is name-shaped, so "label badminton" earns a note while "price tag for
    // the shoes" does not. Naming a real label proves it too, and is checked as we go.
    let reportable = explicit || !/\s/u.test(segmentAt(text, cursor));
    // The first segment always belongs to the directive. After that, only an explicit
    // conjunction carries it into a name that does not resolve: a comma separates clauses as
    // often as it separates names — "label it pickleball, category fun" — so an unknown word
    // after one is the next clause, not a missing label.
    let carriesNames = true;
    let resolvedAny = false;

    // Two cursors, because a connector is only part of the directive if a name follows it.
    // "label it pickleball and Yosh will pay me back" must not lose its "and".
    let settled = -1;
    let probe = cursor;

    for (;;) {
      const label = labelAt(text, probe, byLength);
      if (label) {
        take(label);
        resolvedAny = true;
        reportable = true;
        probe += label.name.length;
      } else {
        const segment = segmentAt(text, probe);

        // A label name can contain "and", which `segmentAt` treats as a list separator, so the
        // whole clause gets a chance before the split does. Bounded by length rather than by
        // `looksLikeName`: this can only ever resolve to a label that really exists, and that is
        // stronger evidence than any shape test.
        const clause = clauseAt(text, probe);
        const viaClause =
          clause.length > segment.length && clause.trim().length <= MAX_NAME_CHARS
            ? resolveByPrefix(clause, labels)
            : ({ kind: "none" } as PrefixMatch);

        if (viaClause.kind === "one") {
          take(viaClause.label);
          resolvedAny = true;
          reportable = true;
          probe += clause.length;
          settled = probe;
          break;
        }

        if (!looksLikeName(segment)) break;

        // No label is named exactly here, so try the name as the start of one. Allowed wherever
        // an exact match would be, since naming a real label is itself the evidence that this is
        // a directive.
        const prefix = resolveByPrefix(segment, labels);
        if (prefix.kind === "one") {
          take(prefix.label);
          resolvedAny = true;
          reportable = true;
          probe += segment.length;
        } else {
          // A name this user does not have, or one that could be two of them. Recorded rather
          // than skipped: the loop used to break here, so "label it pickleball and badminton"
          // applied Pickleball, said nothing about badminton, and left "and badminton" behind as
          // the description. Order made it worse — with the unknown name first, nothing resolved
          // at all and the whole tail came back as one invented label.
          if (!reportable || !carriesNames) break;
          if (prefix.kind === "many") takeAmbiguous(segment.trim(), prefix.candidates);
          else takeUnresolved(segment);
          probe += segment.length;
        }
      }
      settled = probe;

      const connector = CONNECTOR.exec(text.slice(probe));
      if (!connector) break;
      carriesNames = /and|plus|&/iu.test(connector[0]);
      probe += connector[0].length;
    }

    // Removed only where the text is unambiguously an instruction: the keyword carried a colon
    // or a filler word, or a real label was named. "price tag Nike" may be worth a note, but
    // cutting "tag Nike" out of the description on that evidence is not.
    if (settled >= 0 && (explicit || resolvedAny)) spans.push({ start, end: settled });
  }

  // Bare names: a clause that is nothing but a label name. "category fun, pickleball budget"
  // names a label as plainly as "label it pickleball budget" does, and demanding the keyword
  // meant half of how this actually gets written went nowhere.
  //
  // Only a WHOLE clause is considered, never a word inside one, and that is the entire safety
  // argument. "Yosh's Pickleball fee" and "lunch with the pickleball crew" are clauses that do
  // not resolve, so a passing mention still applies nothing — which was the reason bare names
  // were left out to begin with. Removing such a clause is safe for the same reason: it holds a
  // label name and nothing else, so no description text goes with it.
  //
  // A clause that resolves to nothing is silently prose, never reported: "category fun" is not a
  // label the user was denied. That is the one place a name goes unremarked, and it has to be.
  let clauseStart = 0;
  for (const part of text.split(/[,;\n]/)) {
    const start = clauseStart;
    clauseStart += part.length + 1;

    const lead = part.length - part.trimStart().length;
    const from = start + lead;
    const to = from + part.trim().length;
    if (to === from || part.trim().length > MAX_NAME_CHARS) continue;
    // Anything a directive or hashtag already claimed is not a bare name.
    if (spans.some((sp) => sp.start < to && from < sp.end)) continue;

    const resolved = resolveByPrefix(part.trim(), labels);
    if (resolved.kind === "many") {
      takeAmbiguous(part.trim(), resolved.candidates);
      continue;
    }
    if (resolved.kind !== "one") continue;

    // Removed only when it was actually applied. A type-mismatched label is reported and left in
    // place, since cutting it would lose the words and apply nothing.
    const before = ids.length;
    take(resolved.label);
    if (ids.length > before) spans.push({ start: from, end: to });
  }

  // Cut from the end so earlier offsets stay valid.
  let rest = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    rest = rest.slice(0, span.start) + rest.slice(span.end);
  }

  return {
    ids,
    names,
    unresolved,
    incompatible,
    ambiguous,
    removedDirective: spans.length > 0,
    rest: tidy(rest),
  };
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
  directive: Pick<LabelDirective, "names" | "unresolved"> &
    Partial<Pick<LabelDirective, "incompatible" | "ambiguous">>,
  labelsReadable = true
): string => {
  let notice = "";
  if (directive.names.length > 0) {
    notice += `\n\u{1F3F7}\uFE0F *Labels:* ${directive.names.join(", ")}\n`;
  }
  for (const a of directive.ambiguous ?? []) {
    // The candidates are named so the user can answer with the one they meant. Picking one for
    // them would write a label they did not choose, which is the mistake this module avoids
    // hardest — a wrong label moves money in the breakdown.
    notice +=
      `\n\u26a0\ufe0f *${a.name}* could mean ${a.candidates.map((c) => `*${c}*`).join(" or ")}, ` +
      `so I left it off. Name the one you meant.\n`;
  }
  if (directive.incompatible?.length) {
    // Its own message, not "you don't have it": they do have it, and it is sitting in the app
    // where the advice to create it would send them. `Label.applicable_to` is the setting that
    // decides, so that is what the reply names.
    const one = directive.incompatible.length === 1;
    const named = directive.incompatible.map((n) => `*${n}*`).join(", ");
    notice +=
      `\n\u26a0\ufe0f ${named} ${one ? "doesn't" : "don't"} apply to this kind of transaction, ` +
      `so I left ${one ? "it" : "them"} off. Set ${one ? "it" : "them"} to "Both" in the app ` +
      `to use ${one ? "it" : "them"} here.\n`;
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
