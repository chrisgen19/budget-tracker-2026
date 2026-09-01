import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  mcpTokenFindFirst: vi.fn(),
  transactionFindMany: vi.fn(),
  promptLogCreateMany: vi.fn(),
  promptLogDeleteMany: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.userFindMany },
    mcpToken: { findFirst: mocks.mcpTokenFindFirst },
    transaction: { findMany: mocks.transactionFindMany },
    telegramPromptLog: {
      createMany: mocks.promptLogCreateMany,
      deleteMany: mocks.promptLogDeleteMany,
    },
  },
}));
vi.mock("@/lib/telegram/send", () => ({ sendMessage: mocks.sendMessage }));

import { GET } from "@/app/api/cron/telegram-prompts/route";

/** Asia/Manila, `getTimezoneOffset()` convention. */
const MANILA = -480;

/** Tuesday 2026-09-01, 12:00Z = Tuesday 20:00 in Manila. */
const DUE = new Date("2026-09-01T12:00:00.000Z");

const USER = { id: "u1", timezoneOffset: MANILA, telegramDailyPromptTime: "20:00" };

const call = (auth = "Bearer test-secret") =>
  GET(new Request("http://localhost/api/cron/telegram-prompts", { headers: { authorization: auth } }));

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  process.env.TELEGRAM_ALLOWED_IDS = "123456";
  process.env.TELEGRAM_MCP_TOKEN = "bot-token";
  vi.useFakeTimers();
  vi.setSystemTime(DUE);

  mocks.mcpTokenFindFirst.mockResolvedValue({ userId: "u1" });
  mocks.userFindMany.mockResolvedValue([USER]);
  mocks.transactionFindMany.mockResolvedValue([]);
  mocks.promptLogCreateMany.mockResolvedValue({ count: 1 });
  mocks.promptLogDeleteMany.mockResolvedValue({ count: 1 });
  mocks.sendMessage.mockResolvedValue(1);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("auth", () => {
  it("refuses to run without CRON_SECRET rather than running unguarded", async () => {
    delete process.env.CRON_SECRET;
    const res = await call();
    expect(res.status).toBe(500);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects a wrong or missing bearer token", async () => {
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call("")).status).toBe(401);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});

describe("when it sends", () => {
  it("sends once at 20:00 Manila, which is midday UTC", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ promptsSent: 1 });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage.mock.calls[0][0]).toBe(123456);
  });

  it("stays quiet before the user's time", async () => {
    vi.setSystemTime(new Date("2026-09-01T11:59:00.000Z")); // 19:59 Manila
    await call();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  // Saturday 00:30 Manila is still Friday in UTC. Reading the container clock sends on a weekend.
  it("does not send on the user's weekend", async () => {
    vi.setSystemTime(new Date("2026-09-05T16:30:00.000Z"));
    await call();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("skips a user who has not switched it on", async () => {
    mocks.userFindMany.mockResolvedValue([]);
    const res = await call();
    expect(await res.json()).toMatchObject({ usersProcessed: 0, promptsSent: 0 });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("sends nothing when the allowlist holds no numeric chat id", async () => {
    process.env.TELEGRAM_ALLOWED_IDS = "somebody";
    await call();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});

describe("what it asks about", () => {
  const loggedIn = (...categories: string[]) =>
    mocks.transactionFindMany.mockResolvedValue(categories.map((name) => ({ category: { name } })));

  it("asks about both when the day is empty", async () => {
    await call();
    expect(mocks.sendMessage.mock.calls[0][1]).toContain("Fare today?");
  });

  it("asks only about lunch when a fare is already logged", async () => {
    loggedIn("Transportation");
    await call();
    const text = mocks.sendMessage.mock.calls[0][1];
    expect(text).toContain("lunch");
    expect(text).not.toContain("Fare today?");
  });

  // The point of the whole feature: a prompt that arrives when nothing is missing trains the
  // reader to ignore it, and an ignored prompt is worth less than none.
  it("says nothing at all when both are already logged", async () => {
    loggedIn("Transportation", "Food & Dining");
    const res = await call();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ promptsSent: 0 });
    // Still claims the day, so a later tick does not reconsider it if a row is then deleted.
    expect(mocks.promptLogCreateMany).toHaveBeenCalled();
  });

  it("reads only the user's own local day", async () => {
    await call();
    const where = mocks.transactionFindMany.mock.calls[0][0].where;
    // 2026-09-01 in Manila starts at 2026-08-31T16:00Z and ends 24 hours later.
    expect(where.date.gte.toISOString()).toBe("2026-08-31T16:00:00.000Z");
    expect(where.date.lt.toISOString()).toBe("2026-09-01T16:00:00.000Z");
    expect(where.userId).toBe("u1");
  });
});

describe("sending at most once a day", () => {
  // The unique index decides this, not a read, so two overlapping ticks cannot both pass.
  it("does not send when the day was already claimed", async () => {
    mocks.promptLogCreateMany.mockResolvedValue({ count: 0 });
    const res = await call();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ promptsSent: 0 });
  });

  it("claims the day before sending, so a crash cannot double-send", async () => {
    await call();
    const claimOrder = mocks.promptLogCreateMany.mock.invocationCallOrder[0];
    const sendOrder = mocks.sendMessage.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(sendOrder);
  });

  it("releases the claim when the send fails, so the next tick retries", async () => {
    mocks.sendMessage.mockRejectedValue(new Error("telegram down"));
    const res = await call();
    expect(mocks.promptLogDeleteMany).toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ promptsSent: 0, errors: 1 });
  });
});

// The bot writes into exactly one budget, so the prompt belongs to that account and to nobody
// else. Without this scoping the toggle is a foot-gun: a second user switching it on would have
// their own day read and this chat messaged about it.
describe("scoping to the bot's owner", () => {
  it("only ever considers the user who owns the bot's MCP token", async () => {
    await call();
    expect(mocks.userFindMany.mock.calls[0][0].where).toMatchObject({
      id: "u1",
      telegramDailyPrompt: true,
    });
  });

  it("sends nothing when the token belongs to nobody", async () => {
    mocks.mcpTokenFindFirst.mockResolvedValue(null);
    const res = await call();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ promptsSent: 0, owner: null });
  });

  it("sends nothing on a deployment with no bot token at all", async () => {
    delete process.env.TELEGRAM_MCP_TOKEN;
    const res = await call();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ owner: null });
  });

  // A revoked token cannot write, so prompting its owner asks for a message the bot then fails
  // to record.
  it("treats a revoked token as no owner", async () => {
    await call();
    expect(mocks.mcpTokenFindFirst.mock.calls[0][0].where).toMatchObject({ revokedAt: null });
  });
});
