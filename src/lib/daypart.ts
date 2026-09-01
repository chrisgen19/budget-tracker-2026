/**
 * What a meal or daypart word means as a clock time.
 *
 * The module has **no imports**, for the same reason `bill-dates.ts` has none: `mcp/server.ts`
 * embeds this text and is compiled by `mcp-server/`'s separate type-check, which cannot resolve
 * anything pulling in `@/types` or zod.
 *
 * These are prompt constants, not parsing rules. Nothing here resolves a word to a timestamp in
 * TypeScript: Gemini does that, because it already holds the message, the user's current wall
 * clock, and the surrounding words that decide whether "dinner" means last night or the one just
 * eaten. A regex over meal words would have to re-derive all three and would still lose on
 * "dinner with mom before the flight". What this file guarantees is that both surfaces ask for the
 * *same* answer, since the Telegram classifier and the MCP write tool are two prompts that had
 * already drifted apart on exactly this point: `create_transactions` taught 'at lunch' -> 12:30
 * while `classify.ts` said only "or the current timestamp above".
 *
 * Times lean Philippine: dinner at 19:00 rather than the 18:00 a Western default would pick, and
 * merienda exists at all. They are a starting point for a model that can see the rest of the
 * message, not a claim about when this user eats.
 */
export const DAYPART_TIMES: ReadonlyArray<{ words: string; time: string }> = [
  { words: "breakfast, almusal, early morning", time: "08:00" },
  { words: "brunch, mid-morning", time: "10:00" },
  { words: "lunch, tanghalian, midday, noon", time: "12:30" },
  { words: "merienda, afternoon snack, afternoon", time: "15:30" },
  { words: "dinner, hapunan, supper, evening", time: "19:00" },
  { words: "late night, after dinner, midnight snack", time: "21:00" },
];

/** The table as prompt text: `- breakfast, almusal, early morning -> 08:00`. */
export const DAYPART_TABLE = DAYPART_TIMES.map((d) => `- ${d.words} -> ${d.time}`).join("\n");

/**
 * The shared instruction for turning loose time-of-day language into a real timestamp.
 *
 * The "most recent occurrence" rule is the part that earns its keep, and it is the one a model
 * does not reach on its own. Someone messaging "350 dinner" at 10:00 is logging last night's meal,
 * not booking tonight's: the purchase has already happened, which is the whole premise of writing
 * it down. Resolving it to today 19:00 stores a transaction in the future, and the alternative the
 * bot used to fall back on -- the current clock -- files a dinner at 10:00 in the morning. Both are
 * wrong in a way the user only discovers later, in a chart.
 *
 * Anchored on "already happened" rather than on "nearest", because nearest is ambiguous at exactly
 * the times people log things: at 16:00, lunch and dinner are equidistant, and only one of them has
 * occurred.
 */
export const DAYPART_GUIDANCE = `Time of day: when the message names a meal or a part of the day, resolve it to a real clock
time rather than using the current time. Use these as the default reading:
${DAYPART_TABLE}
An explicit time always wins over this table ("dinner at 8" is 20:00, not 19:00), and so does a
named day: "yesterday dinner" is yesterday at 19:00, "yesterday morning" is yesterday at 08:00.
When a daypart is named with NO day ("350 dinner", "lunch at jollibee"), resolve it to the MOST
RECENT time that daypart has already passed, relative to the current timestamp above. At 10:00
"dinner" is YESTERDAY at 19:00, because tonight's has not happened yet; at 21:00 the same word is
TODAY at 19:00. Never return a timestamp in the future: a purchase being logged has already been
made.
When the message names no time of day at all, use the current timestamp above.`;
