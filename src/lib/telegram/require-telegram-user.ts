import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAllowlist } from "@/lib/telegram/allowlist";
import { env } from "@/lib/telegram/env";
import { verifyInitData } from "@/lib/telegram/init-data";

/**
 * The gate every `/api/tg/*` route runs first.
 *
 * Shaped exactly like `getAuthUserId` (`src/lib/session.ts:12`) -- it returns the app user's id, or
 * a `NextResponse` to return in its place -- so a route body reads identically whether it is
 * session-authenticated or Telegram-authenticated:
 *
 * ```ts
 * const userId = await getTelegramUserId(request);
 * if (userId instanceof NextResponse) return userId;
 * ```
 *
 * That sameness is the point. A second auth helper with a different calling convention is a second
 * chance to forget the check, and forgetting it here means an unauthenticated write to somebody's
 * finances.
 *
 * **Three independent conditions, all required**, the same belt-and-braces `messageIsAllowed`
 * already applies to a chat message:
 *
 *  1. the payload is signed by *this* bot and is fresh
 *  2. the Telegram id is on the allowlist -- so revoking access in one place revokes it everywhere
 *  3. the Telegram id resolves to an app user
 *
 * Two and three are not redundant. The allowlist is the operational switch and the column is the
 * identity; either alone answers half the question, and a link left behind after an allowlist
 * entry is removed would keep working if only the column were consulted.
 *
 * Nothing is traded for a cookie. Telegram re-supplies `initData` on every launch, revalidating it
 * is two HMACs, and a session cookie would be a second auth system beside NextAuth with its own
 * expiry, refresh and revocation questions -- and would not survive the third-party iframe anyway,
 * since NextAuth's cookie is not `SameSite=None`.
 */

/** The scheme in `Authorization: tma <initData>`, which is the convention Telegram's own
 *  ecosystem settled on. Matched case-insensitively; headers are not a place to be strict. */
const AUTH_SCHEME = "tma";

/**
 * Resolve the app user behind a Mini App request, or the response to return instead.
 *
 * Failures are deliberately opaque and carry no detail about which of the three conditions failed,
 * matching the MCP route's `unauthorized()` and the bot's silent denials. A caller who is allowed
 * in does not need the difference, and a caller who is not should not be told which half of the
 * gate to work on.
 */
export const getTelegramUserId = async (request: Request): Promise<string | NextResponse> => {
  const botToken = env("TELEGRAM_BOT_TOKEN");
  // No token means nothing can be verified, so nothing may be served. This is a misconfiguration
  // rather than a bad request, but answering 500 would tell an anonymous caller that the endpoint
  // exists and is merely broken.
  if (!botToken) return denied();

  const raw = readInitData(request.headers.get("authorization"));
  if (!raw) return denied();

  const verified = verifyInitData(raw, botToken);
  if (!verified) return denied();

  const { ids, usernames } = parseAllowlist(process.env);
  // Ids only. `messageIsAllowed` accepts a username as a convenience because a chat message
  // carries one and a person has to be able to get started, but there is no such bootstrapping
  // problem here: linking an account is already a deliberate one-off, and a released @handle
  // claimed by someone else must never reach a write path.
  if (!ids.has(verified.telegramUserId)) {
    // A username-only allowlist is a configuration that cannot serve the Mini App at all. Said
    // once, at the point it bites, because the alternative is a 403 with no explanation anywhere.
    if (ids.size === 0 && usernames.size > 0) {
      console.warn(
        "[telegram] the Mini App requires a numeric id in TELEGRAM_ALLOWED_IDS; " +
          "TELEGRAM_ALLOWED_USERNAMES alone cannot authorise it."
      );
    }
    return denied();
  }

  const user = await prisma.user.findUnique({
    where: { telegramUserId: verified.telegramUserId },
    select: { id: true },
  });
  if (!user) {
    // The one denial worth a server-side line, because it is the one nobody can diagnose.
    //
    // Everything else here is a refusal the caller earned: a bad signature, a stale payload, an id
    // that is not on the allowlist. This branch means the *right* person, from the *right* bot,
    // holding an allowlisted id -- and the only thing missing is a column set by hand. A restored
    // database loses `users.telegram_user_id` and the Mini App then 401s with no clue anywhere,
    // which reads as the app being broken rather than as one script not yet run.
    //
    // Logged rather than reported in the response: the 401 stays opaque, since a caller who is not
    // allowed in should not be told which half of the gate to work on. Reaching here already
    // required a valid signature from this bot *and* an allowlisted id, so it is not a line an
    // anonymous caller can flood.
    console.warn(
      "[telegram] Telegram id %s is allowlisted but linked to no account, so the Mini App cannot " +
        "act as anyone. Link it: EMAIL=you@example.com TELEGRAM_ID=%s pnpm exec tsx " +
        "--env-file=.env scripts/link-telegram-user.ts --apply",
      verified.telegramUserId,
      verified.telegramUserId
    );
    return denied();
  }

  return user.id;
};

/** `Authorization: tma <initData>`. Anything else, including a bare value with no scheme, is not
 *  a Mini App request -- guessing would let a stray `Bearer` token reach the verifier. */
const readInitData = (header: string | null): string | null => {
  if (!header) return null;

  const separator = header.indexOf(" ");
  if (separator < 0) return null;

  const scheme = header.slice(0, separator);
  const value = header.slice(separator + 1).trim();
  if (scheme.toLowerCase() !== AUTH_SCHEME || !value) return null;

  return value;
};

/** One response for every failure. See the note above on why the reason is not reported. */
const denied = (): NextResponse =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });
