/** Day names. Abbreviations are only honoured after "on", "last", "this" or "next", because
 *  bare "mon", "sat" and "sun" are ordinary words ("sun cream", "he sat"). */
const DAY_FULL = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const DAY_ANY = "mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?|sun";

/** Month names, only ever matched next to a day number. See TEMPORAL_HINT. */
const MONTH = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

/**
 * Meal and daypart words, which say *when* something happened without naming a clock time.
 *
 * Kept apart from `TEMPORAL_HINT` below, because the two are not equally certain and must not be
 * treated the same when there is no model to resolve them. "yesterday" makes the current instant
 * unconditionally wrong. A bare meal word does not: people log breakfast over breakfast, so `now`
 * is frequently right and is never absurd. That difference is what lets a daypart fall back to the
 * fast path when Gemini is unavailable, where "yesterday" is better refused.
 *
 * Both comments in this file already cited meal examples ("350 lunch at noon", "350 dinner 18:00"),
 * but those diverted on `noon` and `18:00` — the meal word itself never counted, so plain
 * "350 dinner" was stamped with whatever time it was sent.
 *
 * `merienda` and the Filipino forms are here because this bot has one user and they are what he
 * would type.
 */
const DAYPART_HINT = new RegExp(
  `\\b(breakfast|almusal|brunch|lunch|tanghalian|merienda|dinner|hapunan|supper|snack)\\b`,
  "i"
);

/**
 * Whether the message names a meal or part of the day.
 *
 * Separate from `isPlainShorthand` so the caller decides what to do about it. Resolving one needs
 * the user's current clock and the surrounding words, which is Gemini's job; with no
 * `GEMINI_API_KEY` there is nothing better than the current instant, and refusing a message this
 * ordinary would break the one path that is supposed to survive without a model.
 */
export const namesDaypart = (text: string): boolean => DAYPART_HINT.test(text);

/**
 * Text that places a transaction somewhere other than right now.
 *
 * The shorthand path is a regex that takes an amount and treats everything after it as the
 * description, then stamps the current instant. "350 groceries yesterday" therefore matched, was
 * filed under today, and carried "yesterday" in its own description as evidence of the mistake.
 * Worse, the invented timestamp then drove label auto-apply, so a Saturday errand entered on a
 * Monday morning could land inside a weekday window and be tagged as work spending.
 *
 * A message carrying any of this goes to Gemini instead, which resolves the date properly.
 *
 * Both kinds of mistake cost something, so the pattern is deliberately conservative about bare
 * words. A missed date files a transaction on the wrong day. A false positive costs a model call,
 * or, with no GEMINI_API_KEY, refuses a message that was perfectly clear.
 *
 * Month and day names are where that bites, because a bare one is not a date at all: "may" cannot
 * place a transaction on a particular day, so diverting on it buys nothing, and "may", "jan" and
 * "sat" double as ordinary words and names. They therefore only count where they genuinely form a
 * date: a month beside a day number, or a day name after on/last/this/next.
 */
const TEMPORAL_HINT = new RegExp(
  [
    // Relative days, and the named clock times, which are as explicit as "18:00" and were
    // taking the fast path: "350 lunch at noon" had its stated time replaced with now.
    `\\b(yesterday|yday|today|tonight|tomorrow|earlier|previously)\\b`,
    `\\b(noon|midday|midnight)\\b`,
    // "last night", "this morning", "next friday", "last week".
    `\\blast\\s+(night|week|month|year|${DAY_ANY})\\w*`,
    `\\b(this|next)\\s+(morning|afternoon|evening|night|week|month|year|${DAY_ANY})\\w*`,
    // "3 days ago", "a week ago".
    `\\b\\w+\\s+(day|week|month|year)s?\\s+ago\\b`,
    `\\bago\\b`,
    // Named days, and abbreviations only where "on" makes them a date.
    `\\b(${DAY_FULL})\\b`,
    `\\bon\\s+(${DAY_FULL}|${DAY_ANY})\\b`,
    // A month only counts beside a day number, in either order.
    `\\b(${MONTH})\\w*\\.?\\s+\\d{1,2}\\b`,
    `\\b\\d{1,2}\\s+(${MONTH})\\w*\\b`,
    // Numeric dates and clock times. The 24-hour form needs no am/pm suffix, and without it
    // "350 dinner 18:00" took the fast path and had its stated time silently replaced by now.
    `\\d{1,2}\\/\\d{1,2}`,
    `\\d{4}-\\d{2}-\\d{2}`,
    `\\b\\d{1,2}(:\\d{2})?\\s*(am|pm)\\b`,
    `\\b([01]?\\d|2[0-3]):[0-5]\\d\\b`,
  ].join("|"),
  "i"
);

/**
 * Whether the fast shorthand path may handle this message.
 *
 * It may not when the text says *when* something happened, because that path has no way to
 * express a date and would silently record the current instant instead.
 */
export const isPlainShorthand = (text: string): boolean => !TEMPORAL_HINT.test(text);
