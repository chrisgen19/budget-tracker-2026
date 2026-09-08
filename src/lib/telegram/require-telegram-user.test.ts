import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userFindUnique: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.userFindUnique } },
}));

import { getTelegramUserId } from "@/lib/telegram/require-telegram-user";

/**
 * The same fixed vector `init-data.test.ts` uses, produced by an independent implementation of
 * Telegram's algorithm. Reused rather than re-signed so this file exercises the real verifier
 * instead of a stub of it -- the three conditions are only worth testing together.
 */
const BOT_TOKEN = "123456:TEST-BOT-TOKEN-NOT-REAL";
const USER_JSON = '{"id":42424242,"first_name":"Chris","username":"Chris_Dev","language_code":"en"}';
const AUTH_DATE_SECONDS = 1757289600;
const VALID_HASH = "75d8d2d3db93a979238d51f3188460176c0b66b797192ca329f7e5ca1df2d5ae";

const INIT_DATA =
  `auth_date=${AUTH_DATE_SECONDS}` +
  `&query_id=AAF_test_query` +
  `&user=${encodeURIComponent(USER_JSON)}` +
  `&hash=${VALID_HASH}`;

const request = (authorization?: string): Request =>
  new Request("https://example.test/api/tg/bootstrap", {
    headers: authorization ? { authorization } : {},
  });

const status = (result: string | NextResponse): number | string =>
  result instanceof NextResponse ? result.status : result;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AUTH_DATE_SECONDS * 1000 + 30_000));

  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_ALLOWED_IDS = "42424242";
  process.env.TELEGRAM_ALLOWED_USERNAMES = "";

  mocks.userFindUnique.mockResolvedValue({ id: "user_1" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getTelegramUserId", () => {
  it("resolves the app user when all three conditions hold", async () => {
    const result = await getTelegramUserId(request(`tma ${INIT_DATA}`));

    expect(result).toBe("user_1");
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { telegramUserId: "42424242" },
      select: { id: true },
    });
  });

  it("accepts the scheme case-insensitively", async () => {
    expect(await getTelegramUserId(request(`TMA ${INIT_DATA}`))).toBe("user_1");
  });

  it("rejects a request with no Authorization header", async () => {
    expect(status(await getTelegramUserId(request()))).toBe(401);
    // Nothing may reach the database before the signature is proven.
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("rejects a Bearer credential rather than passing it to the verifier", async () => {
    // The scheme is checked, not stripped. An MCP token arriving here must not be treated as
    // initData and given a chance to verify against anything.
    expect(status(await getTelegramUserId(request(`Bearer ${INIT_DATA}`)))).toBe(401);
  });

  it("rejects a bare value with no scheme", async () => {
    expect(status(await getTelegramUserId(request(INIT_DATA)))).toBe(401);
  });

  it("rejects a tampered payload", async () => {
    const tampered = `tma ${INIT_DATA.replace("42424242", "99999999")}`;

    expect(status(await getTelegramUserId(request(tampered)))).toBe(401);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("rejects a stale payload", async () => {
    vi.setSystemTime(new Date(AUTH_DATE_SECONDS * 1000 + 48 * 60 * 60 * 1000));

    expect(status(await getTelegramUserId(request(`tma ${INIT_DATA}`)))).toBe(401);
  });

  it("fails closed when TELEGRAM_BOT_TOKEN is unset", async () => {
    // Nothing can be verified without it, so nothing may be served. `createHmac` accepts an empty
    // key perfectly happily, which is exactly the silent-success this guards against.
    delete process.env.TELEGRAM_BOT_TOKEN;

    expect(status(await getTelegramUserId(request(`tma ${INIT_DATA}`)))).toBe(401);
  });

  it("rejects a valid signature whose id is not on the allowlist", async () => {
    // The second of the three conditions, and the one that makes revocation work: removing the id
    // from TELEGRAM_ALLOWED_IDS must lock the Mini App out even though the link column survives.
    process.env.TELEGRAM_ALLOWED_IDS = "777";

    expect(status(await getTelegramUserId(request(`tma ${INIT_DATA}`)))).toBe(401);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("does not accept a username in place of a numeric id", async () => {
    // `messageIsAllowed` allows a username as a bootstrapping convenience. There is no such
    // problem here, and a released @handle claimed by someone else must never reach a write path.
    process.env.TELEGRAM_ALLOWED_IDS = "";
    process.env.TELEGRAM_ALLOWED_USERNAMES = "chris_dev";

    expect(status(await getTelegramUserId(request(`tma ${INIT_DATA}`)))).toBe(401);
  });

  it("rejects an allowlisted id that no account has claimed", async () => {
    // The third condition. Being permitted to talk to the bot is not the same as being an app
    // user, and until someone runs the link script it is not one.
    mocks.userFindUnique.mockResolvedValue(null);

    expect(status(await getTelegramUserId(request(`tma ${INIT_DATA}`)))).toBe(401);
  });

  it("names the fix in the log when the only thing missing is the link", async () => {
    // The one denial nobody can diagnose from outside: the right person, from the right bot, with
    // an allowlisted id, and a column a restored database silently dropped. The 401 stays opaque,
    // so the clue has to be server-side or it does not exist at all.
    mocks.userFindUnique.mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getTelegramUserId(request(`tma ${INIT_DATA}`));

    expect(warn).toHaveBeenCalled();
    const line = warn.mock.calls[0].join(" ");
    expect(line).toContain("link-telegram-user.ts");
    expect(warn.mock.calls[0]).toContain("42424242");
    warn.mockRestore();
  });

  it("says nothing about a caller it merely refused", async () => {
    // Only the unlinked branch earns a line. A bad signature or a stranger's id is a refusal the
    // caller earned, and logging those is noise that hides the one entry worth reading.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getTelegramUserId(request(`tma ${INIT_DATA.replace("42424242", "99999999")}`));

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reports the same failure for every cause", async () => {
    // A caller who is refused must not learn which half of the gate to work on.
    process.env.TELEGRAM_ALLOWED_IDS = "777";
    const wrongList = await getTelegramUserId(request(`tma ${INIT_DATA}`));

    process.env.TELEGRAM_ALLOWED_IDS = "42424242";
    mocks.userFindUnique.mockResolvedValue(null);
    const unlinked = await getTelegramUserId(request(`tma ${INIT_DATA}`));

    const noHeader = await getTelegramUserId(request());

    const bodies = await Promise.all(
      [wrongList, unlinked, noHeader].map((r) => (r as NextResponse).json())
    );
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
  });
});
