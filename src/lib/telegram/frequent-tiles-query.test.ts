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
    // 09:00, so their window starts at local midnight on 4 July -- which is 3 July 16:00Z.
    // Computing it in the process zone would start it a day late and quietly drop a day's habits.
    findMany.mockResolvedValue([]);
    const now = new Date("2026-09-01T01:00:00Z");

    return loadFrequentTiles(prisma, "user_1", -480, { now, windowDays: 60 }).then(() => {
      const { where } = findMany.mock.calls.at(-1)![0];

      expect(where.date.gte.toISOString()).toBe("2026-07-03T16:00:00.000Z");
    });
  });

  it("spans exactly windowDays calendar days, counting today", async () => {
    // Asserted as a span rather than as a boundary date, so it stays honest if the fixture moves.
    //
    // The upper bound already covers the whole of today, so counting back a full `windowDays`
    // spans `windowDays + 1` days. Pinned at three sizes because an off-by-one is invisible at
    // one: a single case passes just as happily under `d - windowDays` if the expectation was
    // written from the code.
    //
    // Awaited one at a time on purpose. Under `Promise.all` every assertion reads
    // `calls.at(-1)`, which is whichever call resolved last rather than its own.
    findMany.mockResolvedValue([]);
    const now = new Date("2026-09-01T01:00:00Z");
    const DAY = 86_400_000;

    for (const windowDays of [1, 7, 60]) {
      await loadFrequentTiles(prisma, "user_1", -480, { now, windowDays });

      const { where } = findMany.mock.calls.at(-1)![0];
      // lte is 23:59:59.999, so the difference rounds to the number of days spanned.
      const spanned = Math.round((where.date.lte - where.date.gte) / DAY);

      expect(spanned).toBe(windowDays);
    }
  });

  it("covers only today when windowDays is 1", () => {
    findMany.mockResolvedValue([]);
    const now = new Date("2026-09-01T01:00:00Z");

    return loadFrequentTiles(prisma, "user_1", -480, { now, windowDays: 1 }).then(() => {
      const { where } = findMany.mock.calls.at(-1)![0];

      expect(where.date.gte.toISOString()).toBe("2026-08-31T16:00:00.000Z");
      expect(where.date.lte.toISOString()).toBe("2026-09-01T15:59:59.999Z");
    });
  });

  it("bounds the window at both ends", () => {
    // The lower bound alone makes the window "the last 60 days, plus all of the future". Nothing
    // in the app bounds a transaction date -- `transactionSchema.date` is `z.string().min(1)`, and
    // neither the batch route nor the MCP tool adds a ceiling -- so a row dated next year is
    // reachable, and it would satisfy `gte` for as long as it takes reality to catch up. It would
    // also sort first under `date: desc` and consume the row cap ahead of genuine recent history.
    findMany.mockResolvedValue([]);
    const now = new Date("2026-09-01T01:00:00Z");

    return loadFrequentTiles(prisma, "user_1", -480, { now }).then(() => {
      const { where } = findMany.mock.calls.at(-1)![0];

      expect(where.date.lte).toBeInstanceOf(Date);
      expect(where.date.lte.getTime()).toBeGreaterThan(where.date.gte.getTime());
    });
  });

  it("includes the whole of the user's today, not just up to this instant", () => {
    // Both bounds are local day boundaries, which is the same rule `resolvePeriod` follows and
    // AGENTS.md states: an end resolved to midnight silently drops the last day of the window.
    //
    // `lte: now` would be the obvious upper bound and is subtly worse. A row entered this morning
    // for dinner tonight would be excluded until the evening and then appear, so a tile would come
    // and go during the day, which is harder to trust than either answer consistently.
    //
    // At 01:00Z on 1 September a UTC+8 user is on the 1st at 09:00, so their day ends at
    // 2026-09-01T15:59:59.999Z.
    findMany.mockResolvedValue([]);
    const now = new Date("2026-09-01T01:00:00Z");

    return loadFrequentTiles(prisma, "user_1", -480, { now }).then(() => {
      const { where } = findMany.mock.calls.at(-1)![0];

      expect(where.date.lte.toISOString()).toBe("2026-09-01T15:59:59.999Z");
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
