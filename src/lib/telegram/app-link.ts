/**
 * A link back to the app, for the things chat cannot do.
 *
 * The bot can create a transaction and nothing else: `create_transactions` is the only write among
 * the fourteen MCP tools, and the absence of a delete or an update is deliberate — it means a
 * leaked bot token can add junk rows but can never destroy or rewrite financial history. Fixing a
 * typo therefore belongs in the app, and a link is how you get there without granting the bot
 * powers it should not have.
 *
 * `?highlight=<id>` is an existing route contract: the transactions page clears the month filter,
 * finds that row across all time and opens its edit modal, which is where both editing and
 * deleting already live.
 */

/** Telegram rejects a keyboard whose URL is not a valid http(s) one, and rejects the *whole*
 *  message with it, so an unusable base URL must yield no button rather than a broken send. */
const USABLE = /^https?:\/\/[^\s/]+/i;

/**
 * The base URL of the deployed app, or null when there is nothing usable to link to.
 *
 * Read from `TELEGRAM_APP_URL` if set, else `NEXTAUTH_URL`, which every deployment already has to
 * define for sessions to work. Nothing is hardcoded: a fork or a staging deploy must not be handed
 * a link into someone else's budget, the same rule `TELEGRAM_MCP_URL` follows.
 */
export const appBaseUrl = (env: Record<string, string | undefined>): string | null => {
  const raw = (env.TELEGRAM_APP_URL ?? env.NEXTAUTH_URL ?? "").trim();
  if (!raw || !USABLE.test(raw)) return null;
  return raw.replace(/\/+$/, "");
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
