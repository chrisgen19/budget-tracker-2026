import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/lib/budget-query-types";
import { loadFrequentTiles } from "@/lib/telegram/frequent-tiles-query";

const findMany = vi.fn();

const prisma = { transaction: { findMany } } as unknown as PrismaClient;

const dbRow = (over: Record<string, unknown> = {}) => ({
  description: "grab",
  amount: 250,
  date: new Date("2026-09-01T04:00:00Z"),
  categoryId: "transportation",
  category: { name: "Transportation" },
  ...over,
});

describe("loadFrequentTiles", () => {
  it("excludes bill payments and receipt splits in the query, not afterwards", () => {
    // Asserted on the `where` rather than on the output, because these are predicates the database
    // applies -- a test on the result would pass just as happily if the rows were loaded and then
    // thrown away, and the point of putting them here is that they are not.
    //
    // A tile writing a plain transaction with no `bill_id` settles no occurrence and does not move
    // the schedule cursor, so a bill-derived button manufactures the exact finding
    // `findUnlinkedBillPayments` exists to report.
    findMany.mockResolvedValue([]);

    return loadFrequentTiles(prisma, "user_1", -480).then(() => {
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user_1",
            type: "EXPENSE",
            billId: null,
            receiptGroupId: null,
          }),
        })
      );
    });
  });

  it("resolves the window in the user's calendar, not the container's", () => {
    // The container runs UTC. At 01:00 UTC on 1 September, a UTC+8 user is already on the 1st at
    // 09:00, and their 60-day window starts on 3 July local -- which is 2 July 16:00Z. Computing
    // it in the process zone would start it a day late and quietly drop a day's habits.
    findMany.mockResolvedValue([]);
    const now = new Date("2026-09-01T01:00:00Z");

    return loadFrequentTiles(prisma, "user_1", -480, { now, windowDays: 60 }).then(() => {
      const { where } = findMany.mock.calls.at(-1)![0];

      expect(where.date.gte.toISOString()).toBe("2026-07-02T16:00:00.000Z");
    });
  });

  it("takes the newest rows when the cap bites", () => {
    // The cap drops the oldest rows, which are the ones least likely to describe a current habit.
    findMany.mockResolvedValue([]);

    return loadFrequentTiles(prisma, "user_1", -480).then(() => {
      const args = findMany.mock.calls.at(-1)![0];

      expect(args.orderBy).toEqual({ date: "desc" });
      expect(args.take).toBeGreaterThan(0);
    });
  });

  it("flattens the joined category and ranks the result", () => {
    findMany.mockResolvedValue([
      dbRow({ date: new Date("2026-09-01T04:00:00Z") }),
      dbRow({ date: new Date("2026-09-02T04:00:00Z") }),
      dbRow({ date: new Date("2026-09-03T04:00:00Z") }),
    ]);

    return loadFrequentTiles(prisma, "user_1", -480).then((tiles) => {
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toMatchObject({
        description: "grab",
        count: 3,
        amount: 250,
        categoryName: "Transportation",
      });
    });
  });

  it("passes ranking options through", () => {
    findMany.mockResolvedValue([
      dbRow({ date: new Date("2026-09-01T04:00:00Z") }),
      dbRow({ date: new Date("2026-09-02T04:00:00Z") }),
    ]);

    return loadFrequentTiles(prisma, "user_1", -480, { minCount: 2 }).then((tiles) => {
      expect(tiles).toHaveLength(1);
    });
  });

  it("drops what is already a configured tile", () => {
    findMany.mockResolvedValue([
      dbRow({ date: new Date("2026-09-01T04:00:00Z") }),
      dbRow({ date: new Date("2026-09-02T04:00:00Z") }),
      dbRow({ date: new Date("2026-09-03T04:00:00Z") }),
    ]);

    return loadFrequentTiles(prisma, "user_1", -480, { excludeKeys: ["Grab"] }).then((tiles) => {
      expect(tiles).toHaveLength(0);
    });
  });
});
