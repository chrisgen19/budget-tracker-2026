import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verification of the signed payload Telegram hands a Mini App.
 *
 * This is the whole security boundary for `/tg` and `/api/tg/*`. Everything behind it writes to a
 * real budget, so it is worth stating plainly: **if this is wrong, anyone who guesses a URL writes
 * to someone's finances.** That is why it is a pure function with no Prisma, no environment reads
 * beyond the token it is handed, and its own test file pinned to a fixed vector.
 *
 * The algorithm is Telegram's (https://core.telegram.org/bots/webapps):
 *
 *   1. take `hash` out of the query string
 *   2. sort the remaining `key=value` pairs and join them with a line feed
 *   3. `secret = HMAC_SHA256(key: "WebAppData", message: <bot token>)`
 *   4. the payload is genuine when `HMAC_SHA256(key: secret, message: <2>)` equals `hash`
 *
 * Note the key/message order in step 3 is the reverse of the intuitive reading: the *constant* is
 * the key and the *token* is the message. Getting it the other way round produces a stable,
 * plausible-looking digest that never matches anything Telegram sends.
 *
 * `node:crypto` rather than `crypto.subtle`: this module is imported only by route handlers, which
 * run on the Node runtime. It must never be imported from `src/instrumentation.ts` or
 * `src/middleware.ts` -- both are compiled for edge as well, which is exactly why
 * `next.config.ts` already carries an `IgnorePlugin` for `lib/telegram/bot`.
 */

/**
 * How long a signed payload stays usable.
 *
 * A bound is not optional. Without one a single captured `initData` string is a permanent
 * credential: it is a plain query string, it travels in a header, and nothing in it expires on its
 * own.
 *
 * 24 hours rather than the hour that reads as the safer number, because **Telegram does not
 * refresh `initData` while the app stays open** -- it is fixed at launch. A window shorter than a
 * plausible session therefore produces a failure the page cannot recover from: every request
 * starts returning 401 and the only fix is closing and reopening the Mini App, which reads as the
 * app being broken. 86400 is what Telegram's own ecosystem libraries default to.
 *
 * The window is not the security boundary in any case. It bounds *replay* of a captured string;
 * what bounds *use* is the pair of checks in `require-telegram-user.ts` -- the id must be on the
 * allowlist and must resolve to a linked account -- and both are revocable in a second.
 *
 * A constant, not an environment variable. A blank Coolify field on a security parameter is
 * exactly the failure `env()` exists to describe, and there is no deployment that wants a
 * different number.
 */
export const MAX_INIT_DATA_AGE_MS = 24 * 60 * 60 * 1000;

/** What a verified payload tells us. Deliberately narrow -- only the fields anything here reads. */
export interface VerifiedInitData {
  /**
   * The Telegram account, as a string.
   *
   * Stringified rather than numeric to match how `TELEGRAM_ALLOWED_IDS` and
   * `users.telegram_user_id` both hold it, so the three can be compared without a conversion at
   * each site. Telegram ids already exceed what a float can represent exactly in some ranges, and
   * a string never rounds.
   */
  telegramUserId: string;
  /** Lower-cased, `@` stripped, matching how the bot's allowlist normalises one. May be absent. */
  username?: string;
  authDate: Date;
  /** The `?startapp=` value, when the app was opened through a direct link. */
  startParam?: string;
}

/**
 * Verify a raw `initData` query string, returning what it says or `null`.
 *
 * `null` for every failure -- bad signature, wrong token, missing field, stale timestamp,
 * unparseable user JSON. There is no partial success to report and no caller that could act on the
 * difference, and a richer result is a richer chance of one branch being read as "close enough".
 *
 * @param raw the verbatim `Telegram.WebApp.initData` string
 * @param botToken the bot the Mini App belongs to
 */
export const verifyInitData = (
  raw: string,
  botToken: string,
  now: Date = new Date()
): VerifiedInitData | null => {
  if (!raw || !botToken) return null;

  // `URLSearchParams` rather than a hand-rolled split: the values are percent-encoded and `user`
  // is a JSON object, so it contains `&`-free but `=`-bearing text that a naive split mangles.
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }

  const hash = params.get("hash");
  if (!hash) return null;

  // The check string is built from *every* remaining field, including ones this codebase never
  // reads. Signing only the known fields would leave the rest unauthenticated, and Telegram adds
  // fields over time -- `signature`, `chat_instance`, `chat_type` all arrived after the original
  // spec. Anything unrecognised is still covered by the signature this way.
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  if (!digestsMatch(expected, hash)) return null;

  const authDate = readAuthDate(params.get("auth_date"));
  if (!authDate) return null;

  // Both directions. A payload from the future is as suspect as a stale one -- it means a clock is
  // wrong somewhere, and the age check cannot be trusted to expire it. A minute of slack absorbs
  // ordinary drift between Telegram's clock and the container's.
  const age = now.getTime() - authDate.getTime();
  if (age > MAX_INIT_DATA_AGE_MS || age < -60_000) return null;

  const user = readUser(params.get("user"));
  if (!user) return null;

  return {
    telegramUserId: user.telegramUserId,
    ...(user.username ? { username: user.username } : {}),
    authDate,
    ...(params.get("start_param") ? { startParam: params.get("start_param")! } : {}),
  };
};

/**
 * Constant-time comparison of two hex digests.
 *
 * `===` on a secret comparison leaks its answer through timing, one byte at a time.
 * `timingSafeEqual` throws on a length mismatch rather than returning false, so the lengths are
 * checked first -- and the buffers are built from hex, so a `hash` carrying non-hex characters
 * decodes short and is rejected here rather than throwing.
 */
const digestsMatch = (expected: string, presented: string): boolean => {
  if (expected.length !== presented.length) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(presented, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
};

/** `auth_date` is Unix seconds. Matched as text first: `Number("")` is a perfectly finite 0, which
 *  would date the payload to 1970 and read as merely very stale rather than as malformed. */
const readAuthDate = (value: string | null): Date | null => {
  if (!value || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
};

/** The `user` field is a JSON object. Its `id` is the only part anything here depends on. */
const readUser = (value: string | null): { telegramUserId: string; username?: string } | null => {
  if (!value) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { id, username } = parsed as { id?: unknown; username?: unknown };

  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;

  return {
    telegramUserId: String(id),
    // Normalised the way `bot.ts` normalises the username allowlist, so the two can be compared
    // without each caller remembering to lower-case.
    ...(typeof username === "string" && username.trim()
      ? { username: username.trim().replace(/^@/, "").toLowerCase() }
      : {}),
  };
};
