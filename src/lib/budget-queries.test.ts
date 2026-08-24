import { describe, it, expect, vi, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  getSpendingByCategory,
  getTopExpenses,
  getMonthlySummary,
  getBudgetOverview,
  searchTransactions,
  getLabelBreakdown,
  getLabelList,
  getBillHistory,
} from "./budget-queries";

/** Asia/Manila. `getTimezoneOffset()` returns -480 for UTC+8, matching users.timezone_offset. */
const MANILA = -480;

/**
 * The live case this suite exists for: 2026-02-28T23:45Z is 2026-03-01T07:45 in Manila,
 * so it belongs to March for a Manila user and to February in UTC.
 */
const BOUNDARY_TX = new Date("2026-02-28T23:45:00.000Z");

type DateFilter = { gte?: Date; lte?: Date; lt?: Date };

/** Captures the `where` Prisma would have been called with, so the date range can be asserted. */
const captureWhere = () => {
  const seen: Array<Record<string, unknown>> = [];
  const prisma = {
    transaction: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        seen.push(where);
        return [];
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        seen.push(where);
        return 0;
      }),
      aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })),
    },
  } as unknown as PrismaClient;
  return { prisma, seen };
};

const dateRange = (where: Record<string, unknown>) => where.date as DateFilter;

afterEach(() => {
  vi.useRealTimers();
});

describe("month boundaries respect the user's timezone", () => {
  it("starts a Manila month 8 hours before the UTC month", async () => {
    const { prisma, seen } = captureWhere();

    await getSpendingByCategory(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });

    const { gte, lte } = dateRange(seen[0]);
    expect(gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
    expect(lte?.toISOString()).toBe("2026-03-31T15:59:59.999Z");
  });

  it("puts the boundary transaction in March for Manila and not February", async () => {
    const { prisma, seen } = captureWhere();

    await getSpendingByCategory(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });
    const march = dateRange(seen[0]);
    expect(BOUNDARY_TX >= march.gte!).toBe(true);
    expect(BOUNDARY_TX <= march.lte!).toBe(true);

    await getSpendingByCategory(prisma, "u1", { month: "2026-02", timezoneOffset: MANILA });
    const february = dateRange(seen[1]);
    expect(BOUNDARY_TX <= february.lte!).toBe(false);
  });

  it("still puts it in February when no offset is given (UTC fallback)", async () => {
    const { prisma, seen } = captureWhere();

    await getSpendingByCategory(prisma, "u1", { month: "2026-02" });

    const { gte, lte } = dateRange(seen[0]);
    expect(gte?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(BOUNDARY_TX >= gte!).toBe(true);
    expect(BOUNDARY_TX <= lte!).toBe(true);
  });

  it("applies the offset in getTopExpenses", async () => {
    const { prisma, seen } = captureWhere();

    await getTopExpenses(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });

    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });

  it("applies the offset in searchTransactions", async () => {
    const { prisma, seen } = captureWhere();

    await searchTransactions(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });

    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });

  it("applies the offset in getBudgetOverview", async () => {
    const { prisma, seen } = captureWhere();

    await getBudgetOverview(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });

    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });
});

describe("the default month follows the user's local day, not the container's", () => {
  it("resolves to March for Manila when UTC is still in February", async () => {
    // 23:45Z on Feb 28 is already 07:45 on Mar 1 in Manila.
    vi.useFakeTimers();
    vi.setSystemTime(BOUNDARY_TX);

    const { prisma, seen } = captureWhere();
    await getBudgetOverview(prisma, "u1", { timezoneOffset: MANILA });

    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });

  it("resolves to February for a UTC user at the same instant", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BOUNDARY_TX);

    const { prisma, seen } = captureWhere();
    await getBudgetOverview(prisma, "u1", {});

    expect(dateRange(seen[0]).gte?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("getMonthlySummary buckets by the user's local month", () => {
  const summaryPrisma = (rows: Array<{ amount: number; type: string; date: Date }>) =>
    ({
      transaction: { findMany: vi.fn(async () => rows) },
    }) as unknown as PrismaClient;

  it("counts the boundary transaction in March for Manila", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00.000Z"));

    const result = await getMonthlySummary(
      summaryPrisma([{ amount: 139, type: "EXPENSE", date: BOUNDARY_TX }]),
      "u1",
      { months: 2, timezoneOffset: MANILA }
    );

    expect(result.map((r) => r.month)).toEqual(["Feb 2026", "Mar 2026"]);
    expect(result[0].expenses).toBe(0);
    expect(result[1].expenses).toBe(139);
  });

  it("counts it in February for a UTC user", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00.000Z"));

    const result = await getMonthlySummary(
      summaryPrisma([{ amount: 139, type: "EXPENSE", date: BOUNDARY_TX }]),
      "u1",
      { months: 2 }
    );

    expect(result[0].expenses).toBe(139);
    expect(result[1].expenses).toBe(0);
  });
});

describe("getLabelBreakdown mirrors the analytics page's arithmetic", () => {
  type Tx = { amount: number; labels: Array<{ labelId: string; label: { name: string; color: string } }> };

  const labelPrisma = (rows: Tx[]) =>
    ({ transaction: { findMany: vi.fn(async () => rows) } }) as unknown as PrismaClient;

  const lbl = (id: string) => ({ labelId: id, label: { name: id, color: "#000" } });

  it("splits a transaction's amount evenly across its labels", async () => {
    // One 1000 expense tagged twice contributes 500 to each, so the labels still sum to 1000.
    const result = await getLabelBreakdown(
      labelPrisma([{ amount: 1000, labels: [lbl("work"), lbl("travel")] }]),
      "u1",
      { month: "2026-03" }
    );

    expect(result.total).toBe(1000);
    expect(result.labels.map((l) => [l.name, l.amount])).toEqual([
      ["work", 500],
      ["travel", 500],
    ]);
    expect(result.labels.reduce((s, l) => s + l.amount, 0)).toBe(1000);
  });

  it("counts a transaction once per label, so counts do not sum to the transaction total", async () => {
    const result = await getLabelBreakdown(
      labelPrisma([{ amount: 1000, labels: [lbl("work"), lbl("travel")] }]),
      "u1",
      { month: "2026-03" }
    );

    expect(result.labels.map((l) => l.transactionCount)).toEqual([1, 1]);
  });

  it("buckets untagged transactions under 'unlabeled' rather than dropping them", async () => {
    const result = await getLabelBreakdown(
      labelPrisma([
        { amount: 300, labels: [lbl("work")] },
        { amount: 700, labels: [] },
      ]),
      "u1",
      { month: "2026-03" }
    );

    const unlabeled = result.labels.find((l) => l.id === "unlabeled");
    expect(unlabeled).toBeDefined();
    expect(unlabeled!.amount).toBe(700);
    expect(unlabeled!.transactionCount).toBe(1);
    expect(result.labels.reduce((s, l) => s + l.amount, 0)).toBe(1000);
  });

  it("takes percentages against the period total including unlabeled", async () => {
    const result = await getLabelBreakdown(
      labelPrisma([
        { amount: 250, labels: [lbl("work")] },
        { amount: 750, labels: [] },
      ]),
      "u1",
      { month: "2026-03" }
    );

    expect(result.labels.find((l) => l.name === "work")!.percentage).toBe(25);
    expect(result.labels.find((l) => l.id === "unlabeled")!.percentage).toBe(75);
  });

  it("sorts by amount descending and omits 'unlabeled' when everything is tagged", async () => {
    const result = await getLabelBreakdown(
      labelPrisma([
        { amount: 100, labels: [lbl("small")] },
        { amount: 900, labels: [lbl("big")] },
      ]),
      "u1",
      { month: "2026-03" }
    );

    expect(result.labels.map((l) => l.name)).toEqual(["big", "small"]);
    expect(result.labels.some((l) => l.id === "unlabeled")).toBe(false);
  });

  it("reports zero percentages instead of dividing by zero on an empty month", async () => {
    const result = await getLabelBreakdown(labelPrisma([]), "u1", { month: "2026-03" });

    expect(result.total).toBe(0);
    expect(result.labels).toEqual([]);
  });

  it("defaults to EXPENSE and queries the month in the user's timezone", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const prisma = {
      transaction: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          seen.push(where);
          return [];
        }),
      },
    } as unknown as PrismaClient;

    await getLabelBreakdown(prisma, "u1", { month: "2026-03", timezoneOffset: MANILA });

    expect(seen[0].type).toBe("EXPENSE");
    expect((seen[0].date as DateFilter).gte?.toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });
});

describe("getLabelList", () => {
  const labelPrisma = () => {
    const seen: Array<Record<string, unknown>> = [];
    const prisma = {
      label: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          seen.push(where);
          return [];
        }),
      },
    } as unknown as PrismaClient;
    return { prisma, seen };
  };

  it("treats BOTH labels as matching either type filter", async () => {
    const { prisma, seen } = labelPrisma();

    await getLabelList(prisma, "u1", { applicableTo: "INCOME" });

    expect(seen[0].applicableTo).toEqual({ in: ["INCOME", "BOTH"] });
  });

  it("does not filter when no type is given", async () => {
    const { prisma, seen } = labelPrisma();

    await getLabelList(prisma, "u1", {});

    expect(seen[0].applicableTo).toBeUndefined();
  });
});

describe("searchTransactions label filter", () => {
  const searchPrisma = () => {
    const seen: Array<Record<string, unknown>> = [];
    const prisma = {
      transaction: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          seen.push(where);
          return [];
        }),
        count: vi.fn(async () => 0),
      },
    } as unknown as PrismaClient;
    return { prisma, seen };
  };

  it("matches transactions carrying any of the given labels", async () => {
    const { prisma, seen } = searchPrisma();

    await searchTransactions(prisma, "u1", { labelIds: ["a", "b"] });

    expect(seen[0].labels).toEqual({ some: { labelId: { in: ["a", "b"] } } });
  });

  it("ignores an empty label list rather than matching nothing", async () => {
    const { prisma, seen } = searchPrisma();

    await searchTransactions(prisma, "u1", { labelIds: [] });

    expect(seen[0].labels).toBeUndefined();
  });
});

describe("getBillHistory measures lateness in the user's calendar days", () => {
  type Log = {
    scheduledTransactionId: string;
    dueDate: Date;
    status: string;
    actionDate: Date | null;
    transactionId: string | null;
    snoozeUntil: Date | null;
  };

  const bill = (id: string, description: string) => ({
    id,
    description,
    amount: 100,
    category: { name: "Utilities" },
  });

  const log = (over: Partial<Log> = {}): Log => ({
    scheduledTransactionId: "b1",
    dueDate: new Date("2026-03-05T00:00:00.000Z"),
    status: "PAID",
    actionDate: null,
    transactionId: null,
    snoozeUntil: null,
    ...over,
  });

  const histPrisma = (bills: ReturnType<typeof bill>[], logs: Log[]) =>
    ({
      scheduledTransaction: { findMany: vi.fn(async () => bills) },
      scheduledTransactionLog: { findMany: vi.fn(async () => logs) },
    }) as unknown as PrismaClient;

  it("counts a late-night Manila payment as the local day, not the UTC day", async () => {
    // Real case: acting at 22:09Z on Mar 9 is already 06:09 on Mar 10 in Manila, so a bill
    // due Mar 5 is 5 days late, not the 4 that naive UTC subtraction reports.
    const result = await getBillHistory(
      histPrisma([bill("b1", "BRV")], [log({ actionDate: new Date("2026-03-09T22:09:51.894Z") })]),
      "u1",
      { timezoneOffset: MANILA }
    );

    expect(result.occurrences[0].daysLate).toBe(5);
  });

  it("counts the same payment as 4 days late for a UTC user", async () => {
    const result = await getBillHistory(
      histPrisma([bill("b1", "BRV")], [log({ actionDate: new Date("2026-03-09T22:09:51.894Z") })]),
      "u1",
      {}
    );

    expect(result.occurrences[0].daysLate).toBe(4);
  });

  it("reports 0, not negative, when the local action day equals the due day", async () => {
    // 21:36Z on Mar 19 is 05:36 on Mar 20 in Manila: due Mar 20, paid on time.
    const result = await getBillHistory(
      histPrisma(
        [bill("b1", "PLDT")],
        [
          log({
            dueDate: new Date("2026-03-20T00:00:00.000Z"),
            actionDate: new Date("2026-03-19T21:36:33.943Z"),
          }),
        ]
      ),
      "u1",
      { timezoneOffset: MANILA }
    );

    expect(result.occurrences[0].daysLate).toBe(0);
    expect(result.summaries[0].paidOnTime).toBe(1);
    expect(result.summaries[0].paidLate).toBe(0);
  });

  it("keeps the sign for an early payment rather than clamping to zero", async () => {
    const result = await getBillHistory(
      histPrisma(
        [bill("b1", "Meralco")],
        [
          log({
            dueDate: new Date("2026-04-05T00:00:00.000Z"),
            actionDate: new Date("2026-04-04T04:32:12.734Z"),
          }),
        ]
      ),
      "u1",
      { timezoneOffset: MANILA }
    );

    expect(result.occurrences[0].daysLate).toBe(-1);
    expect(result.summaries[0].avgDaysLate).toBe(-1);
  });

  it("gives skipped and snoozed occurrences no lateness", async () => {
    const result = await getBillHistory(
      histPrisma(
        [bill("b1", "Meralco")],
        [
          log({
            dueDate: new Date("2026-03-05T00:00:00.000Z"),
            status: "SKIPPED",
            actionDate: new Date("2026-03-09T22:32:04.935Z"),
          }),
          log({
            dueDate: new Date("2026-04-05T00:00:00.000Z"),
            status: "SNOOZED",
            snoozeUntil: new Date("2026-04-12T00:00:00.000Z"),
          }),
        ]
      ),
      "u1",
      { timezoneOffset: MANILA }
    );

    expect(result.occurrences.map((o) => o.daysLate)).toEqual([null, null]);
    expect(result.summaries[0].skipped).toBe(1);
    expect(result.summaries[0].snoozed).toBe(1);
  });

  it("excludes skipped and snoozed from the averages", async () => {
    // Only the PAID occurrence has lateness, so the average must be 4, not diluted to 2.
    const result = await getBillHistory(
      histPrisma(
        [bill("b1", "Meralco")],
        [
          log({
            dueDate: new Date("2026-03-05T00:00:00.000Z"),
            actionDate: new Date("2026-03-09T00:00:00.000Z"),
          }),
          log({ dueDate: new Date("2026-04-05T00:00:00.000Z"), status: "SKIPPED" }),
          log({ dueDate: new Date("2026-05-05T00:00:00.000Z"), status: "SNOOZED" }),
        ]
      ),
      "u1",
      {}
    );

    expect(result.summaries[0].occurrences).toBe(3);
    expect(result.summaries[0].paid).toBe(1);
    expect(result.summaries[0].avgDaysLate).toBe(4);
    expect(result.summaries[0].maxDaysLate).toBe(4);
  });

  it("reports null rather than NaN for a bill with no paid occurrences", async () => {
    const result = await getBillHistory(
      histPrisma([bill("b1", "Meralco")], [log({ status: "SKIPPED" })]),
      "u1",
      {}
    );

    expect(result.summaries[0].avgDaysLate).toBeNull();
    expect(result.summaries[0].maxDaysLate).toBeNull();
  });

  it("returns empty rather than throwing when the user has no bills", async () => {
    const result = await getBillHistory(histPrisma([], []), "u1", {});

    expect(result.occurrences).toEqual([]);
    expect(result.summaries).toEqual([]);
  });

  it("sorts the worst average lateness first, with unmeasurable bills last", async () => {
    const result = await getBillHistory(
      histPrisma(
        [bill("b1", "Late"), bill("b2", "Early"), bill("b3", "Skipped")],
        [
          log({ scheduledTransactionId: "b1", actionDate: new Date("2026-03-10T00:00:00.000Z") }),
          log({ scheduledTransactionId: "b2", actionDate: new Date("2026-03-03T00:00:00.000Z") }),
          log({ scheduledTransactionId: "b3", status: "SKIPPED" }),
        ]
      ),
      "u1",
      {}
    );

    expect(result.summaries.map((s) => s.description)).toEqual(["Late", "Early", "Skipped"]);
  });

  it("caps returned occurrences by limit while summaries still cover everything", async () => {
    const result = await getBillHistory(
      histPrisma(
        [bill("b1", "Meralco")],
        [log(), log(), log()].map((l, i) => ({ ...l, dueDate: new Date(`2026-0${i + 1}-05T00:00:00.000Z`) }))
      ),
      "u1",
      { limit: 2 }
    );

    expect(result.occurrences).toHaveLength(2);
    expect(result.summaries[0].occurrences).toBe(3);
  });

  // --- review follow-ups (#113) ---

  it("reads the due date as its stored calendar day, not shifted into the user's timezone", async () => {
    // dueDate is date-only: midnight UTC meaning "the 5th". Converting it for a user west of
    // UTC moves it to the 4th and turns this on-time payment into a day late.
    const paidOnDueDate = [
      log({
        dueDate: new Date("2026-03-05T00:00:00.000Z"),
        actionDate: new Date("2026-03-05T15:00:00.000Z"), // 10:00 on the 5th in UTC-5
      }),
    ];

    const newYork = await getBillHistory(histPrisma([bill("b1", "Rent")], paidOnDueDate), "u1", {
      timezoneOffset: 300,
    });
    expect(newYork.occurrences[0].daysLate).toBe(0);
    expect(newYork.summaries[0].paidOnTime).toBe(1);
    expect(newYork.summaries[0].paidLate).toBe(0);

    // Still correct east of UTC and at UTC itself.
    for (const tz of [MANILA, 0]) {
      const r = await getBillHistory(histPrisma([bill("b1", "Rent")], paidOnDueDate), "u1", {
        timezoneOffset: tz,
      });
      expect(r.occurrences[0].daysLate).toBe(0);
    }
  });

  it("collapses repeated actions on one occurrence into a single occurrence", async () => {
    // Snoozing does not settle an occurrence, so the same (bill, dueDate) can be snoozed
    // twice and then paid. That is one scheduled occurrence, not three.
    const due = new Date("2026-03-05T00:00:00.000Z");
    const result = await getBillHistory(
      histPrisma(
        [bill("b1", "Meralco")],
        [
          log({ dueDate: due, status: "SNOOZED", actionDate: new Date("2026-03-05T02:00:00.000Z") }),
          log({ dueDate: due, status: "SNOOZED", actionDate: new Date("2026-03-06T02:00:00.000Z") }),
          log({ dueDate: due, status: "PAID", actionDate: new Date("2026-03-07T02:00:00.000Z") }),
        ]
      ),
      "u1",
      {}
    );

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0].status).toBe("PAID");
    expect(result.occurrences[0].snoozeCount).toBe(2);
    expect(result.occurrences[0].daysLate).toBe(2);

    const summary = result.summaries[0];
    expect(summary.occurrences).toBe(1);
    expect(summary.paid).toBe(1);
    expect(summary.snoozed).toBe(0);
    expect(summary.totalSnoozes).toBe(2);
    expect(summary.paid + summary.skipped + summary.snoozed).toBe(summary.occurrences);
  });

  it("reports an unsettled occurrence as SNOOZED with its latest snooze", async () => {
    const due = new Date("2026-03-05T00:00:00.000Z");
    const result = await getBillHistory(
      histPrisma(
        [bill("b1", "Meralco")],
        [
          log({
            dueDate: due,
            status: "SNOOZED",
            actionDate: new Date("2026-03-05T02:00:00.000Z"),
            snoozeUntil: new Date("2026-03-06T00:00:00.000Z"),
          }),
          log({
            dueDate: due,
            status: "SNOOZED",
            actionDate: new Date("2026-03-06T02:00:00.000Z"),
            snoozeUntil: new Date("2026-03-09T00:00:00.000Z"),
          }),
        ]
      ),
      "u1",
      {}
    );

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0].status).toBe("SNOOZED");
    expect(result.occurrences[0].snoozeUntil).toBe("2026-03-09T00:00:00.000Z");
    expect(result.occurrences[0].daysLate).toBeNull();
    expect(result.summaries[0].snoozed).toBe(1);
  });

  it("matches the status filter against the settled outcome, not the individual actions", async () => {
    const due = new Date("2026-03-05T00:00:00.000Z");
    const logs = [
      log({ dueDate: due, status: "SNOOZED", actionDate: new Date("2026-03-05T02:00:00.000Z") }),
      log({ dueDate: due, status: "PAID", actionDate: new Date("2026-03-06T02:00:00.000Z") }),
    ];

    const paid = await getBillHistory(histPrisma([bill("b1", "M")], logs), "u1", { status: "PAID" });
    expect(paid.occurrences).toHaveLength(1);

    // It was snoozed, but it settled as PAID, so it must not match a SNOOZED filter.
    const snoozed = await getBillHistory(histPrisma([bill("b1", "M")], logs), "u1", {
      status: "SNOOZED",
    });
    expect(snoozed.occurrences).toHaveLength(0);
    expect(snoozed.summaries).toHaveLength(0);
  });
});

describe("getBillHistory window arithmetic", () => {
  const emptyPrisma = () =>
    ({
      scheduledTransaction: { findMany: vi.fn(async () => []) },
      scheduledTransactionLog: { findMany: vi.fn(async () => []) },
    }) as unknown as PrismaClient;

  it("clamps the lookback to the target month's last day instead of overflowing", async () => {
    // Date.UTC(2026, 1, 31) is Feb 31, which rolls forward to Mar 3 and silently trims
    // three days off the front of a six-month window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));

    const result = await getBillHistory(emptyPrisma(), "u1", { months: 6 });

    expect(result.from).toBe("2026-02-28");
    expect(result.to).toBe("2026-08-31");
  });

  it("clamps into a 30-day month too", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00.000Z"));

    const result = await getBillHistory(emptyPrisma(), "u1", { months: 6 });

    expect(result.from).toBe("2025-11-30");
  });

  it("leaves a day that exists in the target month alone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));

    const result = await getBillHistory(emptyPrisma(), "u1", { months: 6 });

    expect(result.from).toBe("2026-02-24");
  });
});
