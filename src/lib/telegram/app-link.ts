/**
 * A link back to the app, for the things chat cannot do.
 *
 * The bot itself creates transactions and does nothing else: `create_transactions` is the only
 * write any of its handlers calls, so a typo is fixed in the app rather than by chatting at it.
 *
 * Its *token* is no longer that narrow, and the comment used to claim otherwise.
 * `update_transactions` shares the `transactions:write` scope the bot already holds, so a leaked
 * bot token could rewrite rows even though no code path here does. Editing was given its own
 * scope for exactly that reason and then folded back, because the separation cost a re-mint of
 * every existing token and this deployment has one user who holds all of them. Nothing deletes,
 * for anyone, which is the half of the property that still holds unconditionally.
 *
 * `?highlight=<id>` is an existing route contract: the transactions page clears the month filter,
 * finds that row across all time and opens its edit modal, which is where both editing and
 * deleting already live.
 */

/**
 * A base URL Telegram will actually accept, or null.
 *
 * Parsed rather than pattern-matched. A prefix test passes `https://app.example invalid` and
 * `https://app.example:bad`, which `new URL` rejects outright — and the cost of getting that wrong
 * is not a missing button: Telegram rejects the *whole message* when a keyboard carries an invalid
 * URL, so the confirmation that a transaction saved would be lost with it.
 */
const parseBase = (raw: string): string | null => {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // Rebuilt from the parsed parts, so nothing unparsed rides along into the link.
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
};

/** Blank counts as unset, the rule every other TELEGRAM_ variable follows. `??` alone does not do
 *  that: an empty Coolify field would be *selected* over a perfectly good NEXTAUTH_URL and would
 *  silently disable the button the fallback exists to guarantee. */
const set = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * The base URL of the deployed app, or null when there is nothing usable to link to.
 *
 * Read from `TELEGRAM_APP_URL` if set, else `NEXTAUTH_URL`, which every deployment already has to
 * define for sessions to work. Nothing is hardcoded: a fork or a staging deploy must not be handed
 * a link into someone else's budget, the same rule `TELEGRAM_MCP_URL` follows.
 */
export const appBaseUrl = (env: Record<string, string | undefined>): string | null => {
  const raw = set(env.TELEGRAM_APP_URL) ?? set(env.NEXTAUTH_URL);
  return raw ? parseBase(raw) : null;
};

/** The deep link to one transaction's edit modal, or null when there is no base URL. */
export const transactionLink = (baseUrl: string | null, id: string): string | null => {
  const trimmed = id.trim();
  if (!baseUrl || !trimmed) return null;
  return `${baseUrl}/transactions?highlight=${encodeURIComponent(trimmed)}`;
};

/**
 * The inline keyboard for a logged transaction, or undefined when it cannot be built.
 *
 * Undefined rather than an empty keyboard: Telegram renders `{ inline_keyboard: [] }` as a
 * message with no buttons but still spends the field, and undefined is what the send path already
 * treats as "no markup".
 */
export const openInAppKeyboard = (
  baseUrl: string | null,
  id: string
): { inline_keyboard: { text: string; url: string }[][] } | undefined => {
  const url = transactionLink(baseUrl, id);
  return url ? { inline_keyboard: [[{ text: "✏️ Edit in app", url }]] } : undefined;
};
