/** The things the bot can do without asking a model what was meant. */
export type BotCommand =
  | "HELP"
  | "SUMMARY"
  | "RECENT"
  | "BILLS"
  | "CATEGORIES"
  | "TRENDS"
  | "MONTHS"
  | "TOP"
  | "LABELS"
  | "ITEMS"
  | "EXAMPLES";

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
  { command: "EXAMPLES", pattern: /^(examples?|show examples?|what can i ask)$/ },
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
  "/trends": "TRENDS",
  "/months": "MONTHS",
  "/top": "TOP",
  "/labels": "LABELS",
  "/items": "ITEMS",
  "/examples": "EXAMPLES",
};

/**
 * What Telegram shows when the user types "/", and behind the Menu button.
 *
 * The reason this exists: every reporting question the bot answers was reachable only by
 * remembering the phrasing, or by remembering to type /help first. Telegram has a native list
 * for exactly this, and registering it means the features are discoverable without recall.
 *
 * Descriptions are capped at 256 characters by the API and are shown in a narrow dropdown, so
 * they read as labels rather than sentences.
 */
export const COMMAND_MENU: { command: string; description: string }[] = [
  { command: "summary", description: "This month's balance and top spending" },
  { command: "recent", description: "Your last 5 transactions" },
  { command: "bills", description: "Bills due in the next 30 days" },
  { command: "trends", description: "This month against last month" },
  { command: "months", description: "Income and spending, last 6 months" },
  { command: "top", description: "Your biggest expenses" },
  { command: "labels", description: "Spending split across your labels" },
  { command: "items", description: "Line items from your last receipt" },
  { command: "categories", description: "List your categories" },
  { command: "examples", description: "Things you can type, ready to copy" },
  { command: "help", description: "Everything you can ask, including plain English" },
];

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
