import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { AssessmentAnomaly } from "@/types";

const mocks = vi.hoisted(() => ({
  collectAssessmentFacts: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/lib/assessment-facts-query", () => ({ collectAssessmentFacts: mocks.collectAssessmentFacts }));
vi.mock("@/lib/telegram/send", () => ({ sendMessage: mocks.sendMessage }));

import { sendWatchlistDigest } from "@/lib/telegram/watchlist-digest-send";
import { hashWatchlistFindingKey } from "@/lib/watchlist-finding-states";
import { watchlistFindingKey } from "@/lib/watchlist-findings";

const MANILA = -480;
/** Tuesday 2026-09-22, 09:00 in Manila: an hour past an 08:00 digest. */
const NOW = new Date("2026-09-22T01:00:00.000Z");
const USER = { id: "u1", timezoneOffset: MANILA, telegramWatchlistDigestTime: "08:00" };
const PERIOD = { from: "2026-09-01", to: "2026-09-30" };

const finding = (kind: AssessmentAnomaly["kind"], title: string, stateKey: string): AssessmentAnomaly => ({
  kind,
  scope: "outstanding",
  title,
  detail: "",
  severity: "high",
  current: null,
  baseline: null,
  changePct: null,
  stateKey,
});

const MISSED = finding("missed-bill", "1 bill with no payment recorded", "missed");
const DUE = finding("card-payment-due-soon", "BPI Gold is due tomorrow", "card:due-soon:c1:2026-09-23");
const SPIKE = finding("category-spike", "Food & Dining is up this period", "spike");

const hashOf = (f: AssessmentAnomaly) => hashWatchlistFindingKey(watchlistFindingKey(f, PERIOD));

const db = {
  telegramWatchlistDigest: { createMany: vi.fn(), deleteMany: vi.fn() },
  telegramWatchlistAlert: { findMany: vi.fn(), createMany: vi.fn() },
  watchlistFindingState: { findMany: vi.fn() },
};
const prisma = db as unknown as PrismaClient;

const run = (now = NOW) => sendWatchlistDigest(prisma, USER, 123456, now);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELEGRAM_APP_URL = "https://budget.test";
  db.telegramWatchlistDigest.createMany.mockResolvedValue({ count: 1 });
  db.telegramWatchlistDigest.deleteMany.mockResolvedValue({ count: 1 });
  db.telegramWatchlistAlert.findMany.mockResolvedValue([]);
  db.telegramWatchlistAlert.createMany.mockResolvedValue({ count: 1 });
  db.watchlistFindingState.findMany.mockResolvedValue([]);
  mocks.collectAssessmentFacts.mockResolvedValue({ period: PERIOD, anomalies: [MISSED, DUE, SPIKE] });
  mocks.sendMessage.mockResolvedValue(1);
});

describe("sendWatchlistDigest", () => {
  it("does nothing at all before the chosen time", async () => {
    expect(await run(new Date("2026-09-21T23:30:00.000Z"))).toBe("not-due");
    expect(db.telegramWatchlistDigest.createMany).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("reads the user's current calendar month, monthly, so budget findings are in it", async () => {
    await run();
    expect(mocks.collectAssessmentFacts).toHaveBeenCalledWith(
      prisma,
      "u1",
      expect.objectContaining({ from: "2026-09-01", to: "2026-09-30", granularity: "monthly" })
    );
  });

  it("sends the actionable findings as HTML, with a link to the Watchlist", async () => {
    expect(await run()).toBe("sent");
    const [chatId, text, parseMode, keyboard] = mocks.sendMessage.mock.calls[0];
    expect(chatId).toBe(123456);
    expect(parseMode).toBe("HTML");
    expect(text).toContain("Watchlist: 2 new");
    expect(text).not.toContain("Food &amp; Dining");
    expect(keyboard).toEqual({
      inline_keyboard: [[{ text: "Open Watchlist", url: "https://budget.test/analytics?tab=watchlist" }]],
    });
  });

  /** Recorded by the same hash the app stores, so "already sent" and "resolved" speak one language. */
  it("records what it sent, by hash, after Telegram accepted it", async () => {
    await run();
    expect(db.telegramWatchlistAlert.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "u1", findingHash: hashOf(MISSED) },
        { userId: "u1", findingHash: hashOf(DUE) },
      ],
      skipDuplicates: true,
    });
    expect(mocks.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      db.telegramWatchlistAlert.createMany.mock.invocationCallOrder[0]
    );
  });

  /** The unique index decides, not a read, so two overlapping ticks cannot both send. */
  it("sends nothing when today is already claimed", async () => {
    db.telegramWatchlistDigest.createMany.mockResolvedValue({ count: 0 });
    expect(await run()).toBe("already-sent");
    expect(mocks.collectAssessmentFacts).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("claims the day before sending", async () => {
    await run();
    expect(db.telegramWatchlistDigest.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendMessage.mock.invocationCallOrder[0]
    );
  });

  it("skips what an earlier digest already sent", async () => {
    db.telegramWatchlistAlert.findMany.mockResolvedValue([{ findingHash: hashOf(MISSED) }]);
    await run();
    const text = mocks.sendMessage.mock.calls[0][1] as string;
    expect(text).toContain("Watchlist: 1 new");
    expect(text).not.toContain("no payment recorded");
  });

  /**
   * Resolving in the app is the owner saying "I know". The digest reads the same state table
   * through the same key, so this goes through the real `getSuppressingWatchlistStates`.
   */
  it("honours a finding resolved in the app", async () => {
    db.watchlistFindingState.findMany.mockResolvedValue([
      { findingHash: hashOf(MISSED), status: "RESOLVED", snoozedUntil: null },
    ]);
    await run();
    const text = mocks.sendMessage.mock.calls[0][1] as string;
    expect(text).toContain("Watchlist: 1 new");
    expect(text).not.toContain("no payment recorded");
  });

  /** A quiet day keeps its claim: an afternoon finding waits for tomorrow, not a second message. */
  it("stays quiet and keeps the day when nothing is new", async () => {
    mocks.collectAssessmentFacts.mockResolvedValue({ period: PERIOD, anomalies: [SPIKE] });
    expect(await run()).toBe("nothing-new");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(db.telegramWatchlistDigest.deleteMany).not.toHaveBeenCalled();
  });

  /** `sendMessage` reports failure as null. Keeping the claim then would lose the day silently. */
  it("releases the day and throws when Telegram refuses, so the next tick retries", async () => {
    mocks.sendMessage.mockResolvedValue(null);
    await expect(run()).rejects.toThrow(/would not accept/);
    expect(db.telegramWatchlistDigest.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", sentOn: new Date("2026-09-22T00:00:00.000Z") },
    });
    expect(db.telegramWatchlistAlert.createMany).not.toHaveBeenCalled();
  });

  it("releases the day when the findings cannot be read", async () => {
    mocks.collectAssessmentFacts.mockRejectedValue(new Error("db down"));
    await expect(run()).rejects.toThrow("db down");
    expect(db.telegramWatchlistDigest.deleteMany).toHaveBeenCalled();
  });

  /** The message is out. Releasing now would send it a second time on the next tick. */
  it("keeps the day when recording fails after a good send", async () => {
    db.telegramWatchlistAlert.createMany.mockRejectedValue(new Error("write failed"));
    await expect(run()).rejects.toThrow("write failed");
    expect(db.telegramWatchlistDigest.deleteMany).not.toHaveBeenCalled();
  });

  it("sends without a button when no app URL is configured", async () => {
    delete process.env.TELEGRAM_APP_URL;
    delete process.env.NEXTAUTH_URL;
    await run();
    expect(mocks.sendMessage.mock.calls[0][3]).toBeUndefined();
  });
});
