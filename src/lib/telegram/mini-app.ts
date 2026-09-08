import { appBaseUrl } from "@/lib/telegram/app-link";

/**
 * The three ways into the Mini App from inside Telegram, and the one rule they all share.
 *
 * The grid at `/tg` is useless if nobody can reach it, and Telegram offers exactly three places to
 * put a door: the chat's Menu button, an inline `web_app` button on a message, and a command the
 * user types. All three are built from here, because all three fail the same way.
 *
 * **An unusable URL is not a missing button, it is a rejected message.** Telegram refuses the
 * *whole* `sendMessage` when a keyboard carries a URL it will not accept, which `app-link.ts`
 * already learned the hard way for the "Edit in app" link. On the evening prompt that is worse
 * than losing a link: `/api/cron/telegram-prompts` releases its claimed `telegram_prompt_logs` row
 * when the send fails, so the next tick tries again, fails identically, and the prompt is gone for
 * that day -- every day, permanently. So every function here returns *nothing* rather than
 * something Telegram might reject, and the decision is made once, here, rather than at three call
 * sites that would each get it slightly differently.
 *
 * `sendOne`'s plain-text retry is a backstop and not the guard: it drops `reply_markup` entirely,
 * so a bad Mini App button would also take the "Nothing today" button and the Markdown with it.
 */

/**
 * HTTPS, and no exceptions.
 *
 * This is the one place the Mini App is stricter than `appBaseUrl`, which allows `http:` because a
 * plain URL button accepts one. Telegram refuses `http://` for a `web_app` URL outright -- the
 * page is framed inside the client, and it will not frame an insecure origin. Locally that means a
 * tunnel; there is no "just use localhost" path, and pretending otherwise produces a button that
 * fails only in the client and only for the person testing it.
 */
export const miniAppUrl = (env: Record<string, string | undefined>): string | null => {
  const base = appBaseUrl(env);
  if (!base) return null;

  try {
    if (new URL(base).protocol !== "https:") return null;
  } catch {
    return null;
  }

  return `${base}/tg`;
};

/**
 * What the Menu button reads.
 *
 * Short because it sits beside the message box on a phone, and because Telegram truncates rather
 * than wraps. `MENU_BUTTON_MAX_TEXT` is asserted in the tests rather than enforced at runtime: it
 * is a constant in this file, so a violation is a typo caught at build, not a condition to branch
 * on.
 */
export const MENU_BUTTON_TEXT = "Quick Log";
export const MENU_BUTTON_MAX_TEXT = 16;

/** One Telegram API call. The same shape `MenuCall` in `commands.ts` uses, and consumed the same
 *  way -- `telegramApi(call.method, call.params)` -- so the two register identically. */
export interface MenuButtonCall {
  method: "setChatMenuButton";
  params: Record<string, unknown>;
}

/**
 * The calls that put a "Quick Log" button beside the message box, given who may use the bot.
 *
 * Scoped per chat, and the default scope reset, for exactly the reason `menuRegistrations` scopes
 * the "/" menu: the default is what every stranger who finds the bot sees, and this bot answers
 * strangers with silence. A default Menu button would open a page that 401s them -- which is worse
 * than the silent denial, because it confirms the bot is live and hands them a URL to poke at.
 *
 * A chat whose id is not a plain positive integer is skipped, since a chat scope needs a chat id
 * and a username is not one -- the same limitation the "/" menu and the evening prompt already
 * have.
 *
 * **A null `url` clears the button rather than leaving it alone.** That is the half worth not
 * losing: a deployment that had a working `TELEGRAM_APP_URL` and then lost it would otherwise keep
 * a button pointing at a host it no longer controls, and the user would find out by tapping it.
 * Clearing is also what makes this safe to run on every boot.
 */
export const menuButtonRegistrations = (
  allowedIds: Iterable<string>,
  url: string | null
): MenuButtonCall[] => {
  // `default` rather than `commands`: it means "no specific value was set", which is what clearing
  // actually is. Naming `commands` would pin a value an earlier build never chose.
  const cleared = { type: "default" as const };
  const calls: MenuButtonCall[] = [{ method: "setChatMenuButton", params: { menu_button: cleared } }];

  for (const id of allowedIds) {
    // Matched as text before converting, the rule `menuRegistrations` established: `Number("")` is
    // 0, a perfectly safe integer that would scope the button to a chat nobody meant. A private
    // chat id is the user's own id and is always a positive integer, so zero is excluded too.
    if (!/^[1-9]\d*$/.test(id.trim())) continue;

    const chatId = Number(id.trim());
    if (!Number.isSafeInteger(chatId)) continue;

    calls.push({
      method: "setChatMenuButton",
      params: {
        chat_id: chatId,
        menu_button: url
          ? { type: "web_app", text: MENU_BUTTON_TEXT, web_app: { url } }
          : cleared,
      },
    });
  }

  return calls;
};

/** An inline keyboard row holding one `web_app` button. */
export type MiniAppKeyboard = {
  inline_keyboard: { text: string; web_app: { url: string } }[][];
};

/**
 * A message button that opens the Mini App, or undefined when there is nothing safe to open.
 *
 * Undefined rather than an empty keyboard, matching `openInAppKeyboard`: Telegram renders
 * `{ inline_keyboard: [] }` as a message with no buttons but still spends the field, and undefined
 * is what the send path already treats as "no markup".
 *
 * A `web_app` button is only valid in a **private** chat. That holds unconditionally here --
 * `messageIsAllowed` requires a private chat, and the evening prompt addresses a numeric id, which
 * in a private chat is the user's own -- so there is no group case to guard.
 */
export const miniAppKeyboard = (
  url: string | null,
  text: string
): MiniAppKeyboard | undefined =>
  url ? { inline_keyboard: [[{ text, web_app: { url } }]] } : undefined;

/**
 * The Mini App button as a row, for a keyboard that carries other buttons too.
 *
 * An empty array when there is no URL, so a caller can spread it into `inline_keyboard` and get a
 * keyboard with one fewer row rather than one with a hole in it. The evening prompt is the caller:
 * its "Nothing today" button must survive a deployment that cannot offer the grid.
 */
export const miniAppButtonRow = (
  url: string | null,
  text: string
): { text: string; web_app: { url: string } }[][] =>
  url ? [[{ text, web_app: { url } }]] : [];

/**
 * Whether `/quick` may offer the grid to this chat, and why not when it may not.
 *
 * A decision rather than a message, extracted for the reason `menuRegistrations` and
 * `menuButtonRegistrations` are: `bot.ts` has no test of its own, so anything decided inline there
 * is decided where nothing can check it.
 *
 * Two refusals, and they are not the same refusal. `no-url` is a deployment with no HTTPS address.
 * `not-allowlisted-by-id` is the narrower one and is easy to miss: **the Mini App's gate is
 * stricter than the bot's, by exactly one case.** `messageIsAllowed` accepts a username as a
 * bootstrapping convenience -- a person has to be able to get started -- while `getTelegramUserId`
 * refuses one outright, since a released @handle claimed by someone else must never reach a write
 * path. So a sender allowlisted *only* by username can talk to this bot, and handing them a button
 * would open a page that 401s: a door that resolves to nothing, which is the failure
 * `commands.test.ts` already refuses to let a menu entry have.
 *
 * `/quick` is the only surface that can hit it. `menuButtonRegistrations` and the evening prompt
 * both iterate numeric ids and skip everything that is not one, so a username-only allowlist
 * simply gets neither -- only a *typed* command can arrive from someone the id list has never
 * heard of.
 *
 * @param chatId the chat the command arrived in. In a private chat this is the sender's own id,
 *   which is what the allowlist holds -- the equivalence `menuRegistrations` already relies on --
 *   and `messageIsAllowed` requires a private chat before anything reaches here.
 */
export type MiniAppOffer =
  | { offer: true; url: string }
  | { offer: false; reason: "not-allowlisted-by-id" | "no-url" };

export const miniAppOffer = (
  allowedIds: ReadonlySet<string>,
  chatId: number | string,
  url: string | null
): MiniAppOffer => {
  // Checked before the URL, so the more specific cause is the one reported. A username-only
  // allowlist on a deployment that also lacks a base URL has two problems, and being told about
  // the one that would still block them after fixing the other is not help.
  if (!allowedIds.has(String(chatId))) return { offer: false, reason: "not-allowlisted-by-id" };
  if (!url) return { offer: false, reason: "no-url" };
  return { offer: true, url };
};
