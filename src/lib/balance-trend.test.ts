import { describe, expect, it } from "vitest";
import {
  balanceYAxis,
  buildBalanceChartRows,
  buildBalanceMonths,
  formatSignedAmount,
  monthShortName,
  previousMonthKey,
  summarizeBalance,
  type BalanceTrendRow,
} from "@/lib/balance-trend";
import type { BalanceMonth } from "@/types";

const MANILA = -480;

/** A month whose balance moves by `deltas[day]` on the given days of month. */
const makeMonth = (month: string, openingBalance: number, deltas: Record<number, number> = {}): BalanceMonth => {
  const [year, monthNumber] = month.split("-").map(Number);
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  let balance = openingBalance;
  const days = Array.from({ length }, (_, i) => {
    balance += deltas[i + 1] ?? 0;
    return { date: `${month}-${String(i + 1).padStart(2, "0")}`, balance };
  });
  return { month, openingBalance, days };
};

describe("month keys", () => {
  it("steps back across a year boundary", () => {
    expect(previousMonthKey("2026-09")).toBe("2026-08");
    expect(previousMonthKey("2026-01")).toBe("2025-12");
  });

  it("names a month without the process timezone moving it", () => {
    expect(monthShortName("2026-09")).toBe("Sep");
    expect(monthShortName("2026-01")).toBe("Jan");
  });
});

describe("buildBalanceMonths", () => {
  const rows: BalanceTrendRow[] = [
    { amount: 5000, type: "INCOME", date: "2026-08-05T02:00:00.000Z" },
    { amount: 1000, type: "EXPENSE", date: "2026-08-20T02:00:00.000Z" },
    { amount: 2000, type: "EXPENSE", date: "2026-09-03T02:00:00.000Z" },
  ];

  it("derives both opening balances from the closing balance and lands on it exactly", () => {
    const { current, previous } = buildBalanceMonths({
      month: "2026-09",
      closingBalance: 10_000,
      rows,
      timezoneOffset: MANILA,
    });

    expect(previous.month).toBe("2026-08");
    expect(previous.openingBalance).toBe(8000);
    expect(previous.days).toHaveLength(31);
    expect(previous.days[4]).toEqual({ date: "2026-08-05", balance: 13_000 });
    expect(previous.days[30]).toEqual({ date: "2026-08-31", balance: 12_000 });

    expect(current.month).toBe("2026-09");
    expect(current.openingBalance).toBe(12_000);
    expect(current.days).toHaveLength(30);
    expect(current.days[2]).toEqual({ date: "2026-09-03", balance: 10_000 });
    expect(current.days[29]).toEqual({ date: "2026-09-30", balance: 10_000 });
  });

  it("puts a row on the user's calendar day, not the UTC one", () => {
    // 16:30 UTC on Aug 31 is 00:30 on Sep 1 in Manila.
    const lateRow: BalanceTrendRow[] = [{ amount: 500, type: "EXPENSE", date: "2026-08-31T16:30:00.000Z" }];

    const manila = buildBalanceMonths({ month: "2026-09", closingBalance: 0, rows: lateRow, timezoneOffset: MANILA });
    expect(manila.previous.days[30].balance).toBe(500);
    expect(manila.current.days[0]).toEqual({ date: "2026-09-01", balance: 0 });

    const utc = buildBalanceMonths({ month: "2026-09", closingBalance: 0, rows: lateRow, timezoneOffset: 0 });
    expect(utc.previous.days[30].balance).toBe(0);
    expect(utc.current.openingBalance).toBe(0);
  });

  it("walks a short February and rounds to cents", () => {
    const { current, previous } = buildBalanceMonths({
      month: "2026-03",
      closingBalance: 0.3,
      rows: [
        { amount: 0.1, type: "INCOME", date: "2026-02-10T02:00:00.000Z" },
        { amount: 0.2, type: "INCOME", date: "2026-03-10T02:00:00.000Z" },
      ],
      timezoneOffset: MANILA,
    });

    expect(previous.days).toHaveLength(28);
    expect(previous.openingBalance).toBe(0);
    expect(current.openingBalance).toBe(0.1);
    expect(current.days[30].balance).toBe(0.3);
  });
});

describe("buildBalanceChartRows", () => {
  const previous = makeMonth("2026-08", 50_000, { 5: 20_000, 20: -8_000 });
  const current = makeMonth("2026-09", 62_000, { 5: 20_000, 10: -4_000, 25: -1_000 });

  it("stops this month at today and draws no projection after it", () => {
    const rows = buildBalanceChartRows({ current, previous, todayKey: "2026-09-15", compare: false });

    expect(rows).toHaveLength(30);
    expect(rows[14]).toEqual({ day: 15, current: 78_000 });
    // Sep 25 is a future-dated row: it exists in the data but must not be drawn.
    expect(rows[15]).toEqual({ day: 16 });
    expect(rows[24]).toEqual({ day: 25 });
  });

  it("plots both months as the change since their own 1st when comparing", () => {
    const rows = buildBalanceChartRows({ current, previous, todayKey: "2026-09-15", compare: true });

    expect(rows).toHaveLength(31);
    expect(rows[0]).toEqual({ day: 1, current: 0, previous: 0 });
    expect(rows[14]).toEqual({ day: 15, current: 16_000, previous: 20_000 });
    expect(rows[20]).toEqual({ day: 21, previous: 12_000 });
    // Sep has no 31st; Aug's point still belongs on the chart.
    expect(rows[30]).toEqual({ day: 31, previous: 12_000 });
  });

  it("draws a finished month in full and a month still ahead not at all", () => {
    const past = buildBalanceChartRows({ current, previous, todayKey: "2026-10-02", compare: false });
    expect(past.every((row) => row.current != null)).toBe(true);

    const future = buildBalanceChartRows({ current, previous, todayKey: "2026-08-20", compare: false });
    expect(future.every((row) => row.current == null)).toBe(true);
  });
});

describe("summarizeBalance", () => {
  const previous = makeMonth("2026-08", 50_000, { 5: 20_000, 20: -8_000 });
  const current = makeMonth("2026-09", 62_000, { 5: 20_000, 10: -4_000, 25: -1_000 });

  it("states today's balance and compares with the same day last month", () => {
    expect(summarizeBalance(current, previous, "2026-09-15")).toEqual({
      status: "current",
      elapsedDays: 15,
      balance: 78_000,
      change: 16_000,
      previousChange: 20_000,
    });
  });

  it("ignores a future-dated row when stating today's balance", () => {
    expect(summarizeBalance(current, previous, "2026-09-24").balance).toBe(78_000);
  });

  it("compares a 31st with the last day of a shorter month", () => {
    const february = makeMonth("2026-02", 0, { 27: 300, 28: 700 });
    const march = makeMonth("2026-03", 1000, { 31: 50 });

    expect(summarizeBalance(march, february, "2026-03-31").previousChange).toBe(1000);
  });

  it("compares a finished month with the whole of the one before it", () => {
    const january = makeMonth("2026-01", 0, { 30: 400, 31: 600 });
    const february = makeMonth("2026-02", 1000, { 3: 200 });

    const summary = summarizeBalance(february, january, "2026-03-05");
    expect(summary.status).toBe("past");
    // Jan 28 would read 0; a finished February is measured against all of January.
    expect(summary.previousChange).toBe(1000);
  });

  it("does not compare against a month with nothing logged", () => {
    const empty = makeMonth("2026-08", 62_000);
    expect(summarizeBalance(current, empty, "2026-09-15").previousChange).toBeNull();
  });

  it("reports a month still ahead as its opening balance with nothing elapsed", () => {
    expect(summarizeBalance(current, previous, "2026-08-31")).toEqual({
      status: "future",
      elapsedDays: 0,
      balance: 62_000,
      change: 0,
      previousChange: null,
    });
  });
});

describe("balanceYAxis", () => {
  it("keeps a small wobble on a large balance small", () => {
    const { domain: [low, high] } = balanceYAxis([59_900, 60_000, 60_100], false);

    expect(low).toBeLessThan(59_900);
    expect(high).toBeGreaterThan(60_100);
    // The wobble fills less than a tenth of the axis rather than all of it.
    expect(200 / (high - low)).toBeLessThan(0.1);
  });

  it("pads a real move by a tenth either side and ticks on round numbers", () => {
    expect(balanceYAxis([40_000, 60_000], false)).toEqual({
      domain: [38_000, 62_000],
      ticks: [40_000, 45_000, 50_000, 55_000, 60_000],
    });
  });

  it("includes zero when comparing changes, with a tick on it", () => {
    const { domain, ticks } = balanceYAxis([5_000, 8_000], true);

    expect(domain[0]).toBeLessThan(0);
    expect(ticks).toEqual([0, 2_000, 4_000, 6_000, 8_000]);
  });

  it("stays drawable with no data or a flat zero line", () => {
    expect(balanceYAxis([], false).domain).toEqual([0, 1]);
    const { domain: [low, high], ticks } = balanceYAxis([0, 0], false);
    expect(high - low).toBeGreaterThan(0);
    expect(ticks).toContain(0);
  });
});

describe("formatSignedAmount", () => {
  it("spells out the sign and honours the mask", () => {
    expect(formatSignedAmount(8000, "PHP", false)).toBe("+₱8,000.00");
    expect(formatSignedAmount(-1500, "PHP", false)).toBe("-₱1,500.00");
    expect(formatSignedAmount(0, "PHP", false)).toBe("₱0.00");
    expect(formatSignedAmount(8000, "PHP", true)).toBe("₱ ••••••");
  });
});
