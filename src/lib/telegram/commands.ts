/** The things the bot can do without asking a model what was meant. */
export type BotCommand = "HELP" | "SUMMARY" | "RECENT" | "BILLS" | "CATEGORIES";

/**
 * Wraps a subject in the optional politeness around it: an asking verb, an article, a trailing
 * "please". Written once so every command accepts the same shapes, rather than four patterns
 * that each admit a slightly different set by accident.
 */
const phrasing = (subject: string) =>
  new RegExp(`^((give|show|send|get|list|check) (me )?)?((the|my|a) )?(${subject})( please)?$`);

/**
 * Phrasings that resolve to a command locally, without a Gemini round trip.
 *
 * Free text already reaches the right handler: Gemini classifies it and dispatches to the same
 * functions the slash commands use. But paying a model call to recognise the word "summary" is
 * slow, costs an API request, and stops working entirely when GEMINI_API_KEY is unset, at which
 * point a bare "summary" gets "I couldn't understand that command" while "/summary" still works.
 * Recognising the obvious phrasings here makes them instant, free and deterministic, and leaves
 * Gemini for the genuinely conversational cases it is good at.
 *
 * Kept to phrasings that are unambiguous on their own. Anything vaguer stays with the model,
 * because a wrong local guess is worse than a slower correct one: it answers a question the user
 * did not ask, with no indication that it misread them.
 */
const PATTERNS: { command: BotCommand; pattern: RegExp }[] = [
  { command: "HELP", pattern: /^(help|commands?|what can you do)$/ },
  { command: "SUMMARY", pattern: phrasing("summary|balance|overview|totals?") },
  {
    command: "RECENT",
    pattern: phrasing("(recent|latest|last)( transactions?| expenses?| entries)?"),
  },
  { command: "BILLS", pattern: phrasing("(upcoming |due )?bills?") },
  { command: "CATEGORIES", pattern: phrasing("categor(y|ies)( list)?") },
];

/** Slash commands, which stay exact: they are what Telegram's autocomplete offers. */
const SLASH: Record<string, BotCommand> = {
  "/help": "HELP",
  "/start": "HELP",
  "/summary": "SUMMARY",
  "/balance": "SUMMARY",
  "/recent": "RECENT",
  "/bills": "BILLS",
  "/categories": "CATEGORIES",
};

/**
 * Which command a message means, or null to let the rest of the pipeline decide.
 *
 * Returning null is the common case and the safe one: logging, receipts and anything
 * conversational all live downstream.
 */
export const resolveCommand = (text: string): BotCommand | null => {
  const trimmed = text.trim();

  if (trimmed.startsWith("/")) {
    // Telegram appends @botname when a command is used where more than one bot can see it.
    const bare = trimmed.split(/[\s@]/)[0].toLowerCase();
    return SLASH[bare] ?? null;
  }

  // Punctuation only, so "summary?" and "summary!" work; anything with real words in it beyond
  // the pattern falls through to Gemini rather than being forced into a command.
  const normalised = trimmed.toLowerCase().replace(/[?!.,]+$/, "").replace(/\s+/g, " ");

  return PATTERNS.find(({ pattern }) => pattern.test(normalised))?.command ?? null;
};
