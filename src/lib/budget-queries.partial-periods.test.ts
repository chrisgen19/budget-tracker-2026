import { describe, it, expect, vi, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  getSpendingTrends,
  getMonthlySummary,
  describePeriodOrCurrentMonth,
  describePeriod,
} from "./budget-queries";

/** Asia/Manila. `getTimezoneOffset()` returns -480 for UTC+8, matching users.timezone_offset. */
const MANILA = -480;

/**
 * Pin the clock to a Manila wall-clock day.
 *
 * Every assertion here turns on what "today" is, and the whole bug is that a month in progress
 * was treated as finished. A test that read the real clock would pass for 23 days a month and
 * fail on the last, which is the worst possible shape for a regression test.
 */
const pinManilaDay = (day: string) => {
  // 12:00 Manila is 04:00 UTC, comfortably inside the day from either zone's point of view, so
  // the fixture does not itself depend on the offset arithmetic under test.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${day}T04:00:00.000Z`));
};

afterEach(() => {
  vi.useRealTimers();
});

/** A transaction on a given Manila calendar day, stored as the UTC instant the app would store. */
const tx = (localDay: string, amount: number, categoryName: string) => ({
  amount,
  categoryId: `c-${categoryName}`,
  category: { name: categoryName, color: "#000", icon: "X" },
  // Midday local, so the row sits unambiguously inside its own day from either zone.
  date: new Date(`${localDay}T04:00:00.000Z`),
});

type Row = ReturnType<typeof tx>;

/**
 * A Prisma stub that holds one ledger and **actually filters it by the window asked for**.
 *
 * The first version of this keyed a lookup table on the window's start day, which made every
 * assertion here pass with the clip reverted: both the clipped and the unclipped September
 * window start on the 1st, so the stub returned the same rows for each and the test proved
 * nothing. A stub that does not model the thing under test is worse than no test, because it
 * reports the bug as fixed. This one narrows on `gte`/`lte` the way Postgres would.
 */
const fakePrisma = (rows: Row[]) => {
  const seen: Array<{ gte?: Date; lte?: Date }> = [];
  const prisma = {
    transaction: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const range = (where.date ?? {}) as { gte?: Date; lte?: Date };
        seen.push(range);
        return rows.filter(
          (r) =>
            (!range.gte || r.date >= range.gte) && (!range.lte || r.date <= range.lte)
        );
      }),
    },
  } as unknown as PrismaClient;
  return { prisma, seen };
};

/** The local YYYY-MM-DD a stored UTC bound stands for in the user's zone. */
const localDay = (d: Date | undefined) =>
  d ? new Date(d.getTime() - MANILA * 60000).toISOString().slice(0, 10) : null;

describe("getSpendingTrends clips a running month against the same days (#236)", () => {
  /**
   * The production case, with the real figures from 2026-09-07.
   *
   * September 1-7 came to 19,121 against August 1-7's 15,883: a 20% rise. Comparing the same
   * seven days against the whole of August (82,124) reported it as a 77% *fall*. This assertion
   * fails outright if the clip is removed -- the sign of the answer flips.
   */
  it("reports a rise as a rise, not as the fall a whole-month comparison produces", async () => {
    pinManilaDay("2026-09-07");

    const { prisma } = fakePrisma([
      // September so far: the seven days that have happened.
      tx("2026-09-03", 19121, "Everything"),
      // August 1-7, and then the rest of August. The remainder is what an unclipped comparison
      // pulls in, and it is the bulk of the month -- which is exactly why the answer flipped.
      tx("2026-08-03", 15883, "Everything"),
      tx("2026-08-20", 66241, "Everything"),
    ]);

    const result = await getSpendingTrends(prisma, "u1", {
      currentMonth: "2026-09",
      previousMonth: "2026-08",
      timezoneOffset: MANILA,
    });

    // Clipped: August's first seven days only. Unclipped this is 82,124 and the change is -77%.
    expect(result.previousTotal).toBe(15883);
    expect(result.totalChange).toBeGreaterThan(0);
    expect(result.totalChangePercent).toBe(20);
  });

  it("clips both months to the current day of the month", async () => {
    pinManilaDay("2026-09-07");
    const { prisma, seen } = fakePrisma([]);

    const result = await getSpendingTrends(prisma, "u1", {
      currentMonth: "2026-09",
      previousMonth: "2026-08",
      timezoneOffset: MANILA,
    });

    expect(result.throughDay).toBe(7);
    expect(result.currentPeriod).toMatchObject({ from: "2026-09-01", to: "2026-09-07" });
    expect(result.previousPeriod).toMatchObject({ from: "2026-08-01", to: "2026-08-07" });

    const windows = seen.map((r) => [localDay(r.gte), localDay(r.lte)]);
    expect(windows).toHaveLength(2);
    expect(windows).toContainEqual(["2026-09-01", "2026-09-07"]);
    expect(windows).toContainEqual(["2026-08-01", "2026-08-07"]);
  });

  it("does not report Housing as -100% merely because the rent is not yet due", async () => {
    pinManilaDay("2026-09-07");

    const { prisma } = fakePrisma([
      tx("2026-09-03", 1640, "Food & Dining"),
      tx("2026-08-03", 1069, "Food & Dining"),
      // The rent. It lands on the 17th, so it is inside neither seven-day window -- but an
      // unclipped August contains it, which is what produced "Housing -100%".
      tx("2026-08-17", 22000, "Housing"),
    ]);

    const result = await getSpendingTrends(prisma, "u1", {
      currentMonth: "2026-09",
      previousMonth: "2026-08",
      timezoneOffset: MANILA,
    });

    expect(result.byCategory.find((c) => c.name === "Housing")).toBeUndefined();
    expect(result.byCategory.find((c) => c.name === "Food & Dining")?.changePercent).toBe(53);
  });

  it("compares two finished months whole", async () => {
    pinManilaDay("2026-09-07");
    const { prisma, seen } = fakePrisma([]);

    const result = await getSpendingTrends(prisma, "u1", {
      currentMonth: "2026-08",
      previousMonth: "2026-07",
      timezoneOffset: MANILA,
    });

    expect(result.throughDay).toBeNull();
    const windows = seen.map((r) => [localDay(r.gte), localDay(r.lte)]);
    expect(windows).toContainEqual(["2026-08-01", "2026-08-31"]);
    expect(windows).toContainEqual(["2026-07-01", "2026-07-31"]);
  });

  it("clamps the clip to a shorter comparison month rather than asking for 30 February", async () => {
    pinManilaDay("2026-03-30");
    const { prisma, seen } = fakePrisma([]);

    const result = await getSpendingTrends(prisma, "u1", {
      currentMonth: "2026-03",
      previousMonth: "2026-02",
      timezoneOffset: MANILA,
    });

    expect(result.throughDay).toBe(30);
    expect(result.previousPeriod.to).toBe("2026-02-28");
    expect(seen.map((r) => localDay(r.lte))).toContain("2026-02-28");
  });

  it("does not clip on the last day of the month, when nothing is missing", async () => {
    pinManilaDay("2026-09-30");
    const { prisma } = fakePrisma([]);

    const result = await getSpendingTrends(prisma, "u1", {
      currentMonth: "2026-09",
      previousMonth: "2026-08",
      timezoneOffset: MANILA,
    });

    expect(result.throughDay).toBeNull();
    expect(result.currentPeriod.to).toBe("2026-09-30");
  });
});

describe("getMonthlySummary marks the month still running (#236)", () => {
  const summaryPrisma = () =>
    ({
      transaction: { findMany: vi.fn(async () => []) },
    }) as unknown as PrismaClient;

  it("flags the current month as partial and says how far through it is", async () => {
    pinManilaDay("2026-09-07");

    const months = await getMonthlySummary(summaryPrisma(), "u1", {
      months: 2,
      timezoneOffset: MANILA,
    });

    const [august, september] = months;
    expect(august).toMatchObject({
      monthKey: "2026-08",
      isPartial: false,
      daysInMonth: 31,
      daysElapsed: 31,
    });
    expect(september).toMatchObject({
      monthKey: "2026-09",
      isPartial: true,
      daysInMonth: 30,
      daysElapsed: 7,
    });
  });
});

describe("the period echo says whether the window has finished (#236)", () => {
  it("marks the current month partial and a past month complete", () => {
    pinManilaDay("2026-09-07");

    expect(describePeriodOrCurrentMonth({ month: "2026-09" }, MANILA)).toMatchObject({
      isPartial: true,
      daysInPeriod: 30,
      daysElapsed: 7,
    });
    expect(describePeriodOrCurrentMonth({ month: "2026-08" }, MANILA)).toMatchObject({
      isPartial: false,
      daysInPeriod: 31,
      daysElapsed: 31,
    });
  });

  it("counts a range that straddles today only as far as today", () => {
    pinManilaDay("2026-09-07");

    expect(describePeriod({ from: "2026-09-01", to: "2026-09-30" }, MANILA)).toMatchObject({
      isPartial: true,
      daysInPeriod: 30,
      daysElapsed: 7,
    });
  });

  it("treats a window open at the end as still running", () => {
    pinManilaDay("2026-09-07");

    expect(describePeriod({ from: "2026-09-01" }, MANILA)).toMatchObject({
      isPartial: true,
      daysInPeriod: null,
      daysElapsed: 7,
    });
  });

  it("reports zero elapsed days for a window entirely in the future", () => {
    pinManilaDay("2026-09-07");

    expect(describePeriod({ from: "2026-10-01", to: "2026-10-31" }, MANILA)).toMatchObject({
      isPartial: true,
      daysInPeriod: 31,
      daysElapsed: 0,
    });
  });
});
