import { describe, it, expect } from "vitest";
import {
  buildAssessmentFacts,
  computeCoverage,
  computeCategoryMovements,
  computeRecurring,
  findDuplicates,
  findLoggingGaps,
  findMissedOccurrences,
  assessBillAccuracy,
  findUnlinkedBillPayments,
  monthRange,
  resolveFactsWindow,
  MIN_COVERAGE_PCT,
  type FactBill,
  type FactTransaction,
} from "./assessment-facts";

let seq = 0;
const tx = (over: Partial<FactTransaction> & { localDate: string; amount: number }): FactTransaction => ({
  id: `t${(seq += 1)}`,
  type: "EXPENSE",
  description: "thing",
  categoryId: "c1",
  categoryName: "Food & Dining",
  billId: null,
  labelCount: 1,
  ...over,
});

/** Spread `count` expenses across the first `count` days of a month. */
const spread = (month: string, count: number, over: Partial<FactTransaction> = {}): FactTransaction[] =>
  Array.from({ length: count }, (_, i) =>
    tx({ localDate: `${month}-${String(i + 1).padStart(2, "0")}`, amount: 100, ...over }));

const bill = (over: Partial<FactBill> = {}): FactBill => ({
  id: "b1",
  description: "Meralco",
  categoryName: "Utilities",
  amount: 5500,
  isVariable: false,
  frequency: "MONTHLY",
  customIntervalDays: null,
  startDate: new Date(Date.UTC(2026, 0, 5)),
  nextDueDate: new Date(Date.UTC(2026, 6, 5)),
  endDate: null,
  payments: [],
  occurrences: [],
  ...over,
});

describe("computeCoverage", () => {
  it("reports a month with no rows at all rather than dropping it", () => {
    const months = monthRange("2026-04", "2026-06");
    const coverage = computeCoverage(spread("2026-04", 25), months, "2026-07");
    expect(coverage.map((m) => m.month)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(coverage[1]).toMatchObject({ month: "2026-05", coveragePct: 0, status: "low-coverage" });
  });

  it("excludes a month logged on fewer than 60% of its days", () => {
    const coverage = computeCoverage(spread("2026-08", 16), ["2026-08"], "2026-09");
    // 16 of 31 days is 52%: a logging gap, not a cheap month.
    expect(coverage[0].coveragePct).toBeLessThan(MIN_COVERAGE_PCT);
    expect(coverage[0].status).toBe("low-coverage");
  });

  it("marks the current month partial rather than under-covered", () => {
    // Three days into September, 90% of the month is simply in the future.
    const coverage = computeCoverage(spread("2026-09", 3), ["2026-09"], "2026-09");
    expect(coverage[0].status).toBe("partial");
  });
});

describe("findLoggingGaps", () => {
  it("finds a gap and says whether it falls in the period", () => {
    const rows = [
      tx({ localDate: "2026-08-01", amount: 10 }),
      tx({ localDate: "2026-08-12", amount: 10 }),
      tx({ localDate: "2026-08-13", amount: 10 }),
    ];
    const gaps = findLoggingGaps(rows, { from: "2026-08-01", to: "2026-08-31" });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ from: "2026-08-01", to: "2026-08-12", days: 11, inPeriod: true });
  });

  it("ignores stretches shorter than four days", () => {
    const rows = [tx({ localDate: "2026-08-01", amount: 10 }), tx({ localDate: "2026-08-03", amount: 10 })];
    expect(findLoggingGaps(rows, { from: "2026-08-01", to: "2026-08-31" })).toHaveLength(0);
  });
});

describe("computeCategoryMovements", () => {
  /**
   * The bug this pins: averaging only the months a category appeared in measures
   * it against itself. Seen once at 100 across four baseline months, its baseline
   * is 25, not 100 — so a rise to 200 is +700%, not +100%.
   */
  it("zero-fills the months a category did not appear in", () => {
    const rows = [
      tx({ localDate: "2026-04-10", amount: 100, categoryName: "Subscriptions" }),
      tx({ localDate: "2026-08-10", amount: 200, categoryName: "Subscriptions" }),
    ];
    const [m] = computeCategoryMovements(rows, ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"], "2026-08");
    expect(m.priorAvg).toBe(25);
    expect(m.changePct).toBe(700);
    expect(m.direction).toBe("up");
  });

  it("calls a category with no baseline a debut rather than an infinite rise", () => {
    const rows = [tx({ localDate: "2026-08-10", amount: 500, categoryName: "Gym" })];
    const [m] = computeCategoryMovements(rows, ["2026-07", "2026-08"], "2026-08");
    expect(m.direction).toBe("new");
    expect(m.changePct).toBeNull();
  });

  it("ranks by money moved, not by percentage", () => {
    const rows = [
      ...Array.from({ length: 2 }, (_, i) => tx({ localDate: `2026-0${7 + i}-05`, amount: i === 0 ? 100 : 300, categoryName: "Donation" })),
      ...Array.from({ length: 2 }, (_, i) => tx({ localDate: `2026-0${7 + i}-06`, amount: i === 0 ? 2000 : 4040, categoryName: "Subscriptions" })),
    ];
    const movements = computeCategoryMovements(rows, ["2026-07", "2026-08"], "2026-08");
    // Donation trebled and Subscriptions merely doubled, but 2,040 of movement
    // matters more than 200 and must not be crowded out.
    expect(movements[0].category).toBe("Subscriptions");
  });
});

describe("computeRecurring", () => {
  it("counts a charge seen in four distinct months as established", () => {
    const rows = ["2026-04", "2026-05", "2026-06", "2026-07"].map((m) =>
      tx({ localDate: `${m}-03`, amount: 499, description: "Netflix" }));
    const { items } = computeRecurring(rows, "2026-08-20", 10_000);
    expect(items[0]).toMatchObject({ description: "Netflix", months: 4, isNew: false });
  });

  it("flags a charge seen twice inside 120 days as new, without waiting four months", () => {
    const rows = [
      tx({ localDate: "2026-07-03", amount: 900, description: "Spotify Family" }),
      tx({ localDate: "2026-08-03", amount: 900, description: "Spotify Family" }),
    ];
    const { newItems } = computeRecurring(rows, "2026-08-20", 10_000);
    expect(newItems.map((i) => i.description)).toEqual(["Spotify Family"]);
  });

  /**
   * The window's own first row is not the first sighting. A subscription running
   * for two years enters a six-month window looking 120 days old, and every
   * established charge was reported as creep.
   */
  it("does not call a charge new when it predates the window", () => {
    const rows = [
      tx({ localDate: "2026-07-03", amount: 900, description: "Spotify Family" }),
      tx({ localDate: "2026-08-03", amount: 900, description: "Spotify Family" }),
    ];
    const history = new Map([["spotify family", "2024-01-03"]]);
    expect(computeRecurring(rows, "2026-08-20", 10_000, history).newItems).toEqual([]);
  });

  it("drops a new charge too small to be worth reporting", () => {
    const rows = [
      tx({ localDate: "2026-07-03", amount: 65, description: "Buko Juice" }),
      tx({ localDate: "2026-08-03", amount: 65, description: "Buko Juice" }),
    ];
    // 65 a month against a 78,000 month is 0.08% — it repeats faithfully and
    // decides nothing.
    expect(computeRecurring(rows, "2026-08-20", 78_000).newItems).toEqual([]);
  });

  it("folds descriptions so spacing and case do not split one charge in two", () => {
    const rows = ["2026-04", "2026-05", "2026-06", "2026-07"].map((m, i) =>
      tx({ localDate: `${m}-03`, amount: 499, description: i % 2 === 0 ? "Netflix" : "  netflix " }));
    expect(computeRecurring(rows, "2026-08-01", 10_000).items).toHaveLength(1);
  });
});

describe("findDuplicates", () => {
  it("groups rows sharing a day, a description and an amount", () => {
    const rows = [
      tx({ localDate: "2026-08-04", amount: 1200, description: "Grocery run" }),
      tx({ localDate: "2026-08-04", amount: 1200, description: "Grocery run" }),
      tx({ localDate: "2026-08-05", amount: 1200, description: "Grocery run" }),
    ];
    const dupes = findDuplicates(rows, { from: "2026-08-01", to: "2026-08-31" });
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toMatchObject({ copies: 2, inPeriod: true });
  });
});

describe("findMissedOccurrences", () => {
  const sep6 = new Date(Date.UTC(2026, 8, 6));
  const sep1 = new Date(Date.UTC(2026, 8, 1));
  const estimate = { amount: 5500, isEstimate: false };

  it("reports every due date that passed with nothing recorded against it", () => {
    const miss = findMissedOccurrences(bill({ nextDueDate: new Date(Date.UTC(2026, 6, 5)) }), sep6, estimate);
    expect(miss?.missedDueDates).toEqual(["2026-07-05", "2026-08-05", "2026-09-05"]);
    expect(miss?.estimatedArrears).toBe(16_500);
    expect(miss?.daysOverdue).toBe(63);
  });

  /**
   * The walk starts at `nextDueDate`, not at the bill's start date. This bill has
   * run since January and the app's cursor sits at July, so January through June
   * were already passed over — reporting them would contradict the bills page.
   */
  it("does not reach back past the app's own cursor", () => {
    const miss = findMissedOccurrences(bill({ nextDueDate: new Date(Date.UTC(2026, 6, 5)) }), sep6, estimate);
    expect(miss?.missedDueDates.some((d) => d < "2026-07-05")).toBe(false);
  });

  it("treats a paid or skipped occurrence as settled", () => {
    const b = bill({
      nextDueDate: new Date(Date.UTC(2026, 6, 5)),
      occurrences: [
        { dueDate: new Date(Date.UTC(2026, 6, 5)), status: "PAID", transactionId: "t1", snoozeUntil: null },
        { dueDate: new Date(Date.UTC(2026, 7, 5)), status: "SKIPPED", transactionId: null, snoozeUntil: null },
      ],
    });
    expect(findMissedOccurrences(b, sep1, estimate)).toBeNull();
  });

  it("does not call a live snooze a miss — it is a deferral the user chose", () => {
    const b = bill({
      nextDueDate: new Date(Date.UTC(2026, 7, 5)),
      startDate: new Date(Date.UTC(2026, 7, 5)),
      occurrences: [
        { dueDate: new Date(Date.UTC(2026, 7, 5)), status: "SNOOZED", transactionId: null, snoozeUntil: new Date(Date.UTC(2026, 8, 20)) },
      ],
    });
    expect(findMissedOccurrences(b, sep1, estimate)).toBeNull();
  });

  it("counts a lapsed snooze as missed again", () => {
    const b = bill({
      nextDueDate: new Date(Date.UTC(2026, 7, 5)),
      startDate: new Date(Date.UTC(2026, 7, 5)),
      occurrences: [
        { dueDate: new Date(Date.UTC(2026, 7, 5)), status: "SNOOZED", transactionId: null, snoozeUntil: new Date(Date.UTC(2026, 7, 20)) },
      ],
    });
    expect(findMissedOccurrences(b, sep1, estimate)?.missedDueDates).toEqual(["2026-08-05"]);
  });

  it("leaves a bill due today alone — the app calls that on time, and so does this", () => {
    const b = bill({ startDate: new Date(Date.UTC(2026, 8, 6)), nextDueDate: new Date(Date.UTC(2026, 8, 6)) });
    expect(findMissedOccurrences(b, sep6, estimate)).toBeNull();
  });
});

describe("assessBillAccuracy", () => {
  const payments = (...amounts: number[]) =>
    amounts.map((amount, i) => ({ id: `p${i}`, date: new Date(Date.UTC(2026, i, 15)), amount }));

  it("calls a metered bill seasonal when the budget sits inside what was paid", () => {
    const b = assessBillAccuracy(bill({ amount: 5500, payments: payments(5300, 8564, 14126) }));
    expect(b.verdict).toBe("seasonal");
    expect(b.swing).toBeGreaterThanOrEqual(2);
  });

  /**
   * Swing alone is not enough. Budgeted at 100 and paid 300-600 also swings 2x,
   * but every payment disagrees with the figure and a better constant plainly
   * exists — so the variance warning has to stand.
   */
  it("still calls a bill under-budgeted when no payment comes near the figure", () => {
    expect(assessBillAccuracy(bill({ amount: 100, payments: payments(300, 300, 600) })).verdict).toBe("under-budgeted");
  });

  it("leaves a bill alone when the average is within 15% of budget", () => {
    expect(assessBillAccuracy(bill({ amount: 1000, payments: payments(1050, 950, 1010) })).verdict).toBe("ok");
  });

  it("reports a bill with no payments rather than judging its figure", () => {
    expect(assessBillAccuracy(bill()).verdict).toBe("no-payments");
  });
});

describe("findUnlinkedBillPayments", () => {
  it("finds spending named after a bill that never advanced its schedule", () => {
    const rows = [
      tx({ localDate: "2026-08-05", amount: 5300, description: "meralco ", categoryName: "Utilities" }),
      tx({ localDate: "2026-07-05", amount: 5100, description: "Meralco", categoryName: "Utilities", billId: "b1" }),
    ];
    const found = findUnlinkedBillPayments([bill()], rows);
    expect(found).toEqual([
      expect.objectContaining({ billDescription: "Meralco", count: 1, total: 5300 }),
    ]);
  });
});

describe("resolveFactsWindow", () => {
  it("never runs past the current month, so a yearly period reports no empty future", () => {
    const w = resolveFactsWindow({ from: "2026-01-01", to: "2026-12-31" }, "2026-09-06");
    expect(w.months.at(-1)).toBe("2026-09");
    expect(w.months.at(0)).toBe("2026-01");
  });

  it("looks six months back from a monthly period", () => {
    const w = resolveFactsWindow({ from: "2026-09-01", to: "2026-09-30" }, "2026-09-06");
    expect(w.months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(w.dataFrom).toBe("2026-04-01");
  });
});

describe("buildAssessmentFacts", () => {
  /** Five well-logged months, then a partial September with a dining blow-out. */
  const history = [
    ...["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].flatMap((m) => [
      ...spread(m, 25, { amount: 400, categoryName: "Food & Dining", description: "lunch" }),
      tx({ localDate: `${m}-01`, amount: 40_000, type: "INCOME", categoryName: "Salary", description: "Salary" }),
    ]),
    ...spread("2026-09", 5, { amount: 3000, categoryName: "Food & Dining", description: "dinner out" }),
  ];

  const facts = () =>
    buildAssessmentFacts({
      currency: "PHP",
      period: { from: "2026-09-01", to: "2026-09-30", label: "September 2026", granularity: "monthly" },
      today: "2026-09-06",
      timezoneOffset: -480,
      historyMonths: 6,
      transactions: history,
      bills: [bill({ nextDueDate: new Date(Date.UTC(2026, 6, 5)) })],
    });

  it("keeps the partial month out of the baseline it is compared against", () => {
    const f = facts();
    expect(f.confidence.trustworthyMonths).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(f.confidence.months.at(-1)).toMatchObject({ month: "2026-09", status: "partial" });
  });

  it("raises the missed bill above the spending findings", () => {
    const kinds = facts().anomalies.map((a) => a.kind);
    expect(kinds[0]).toBe("missed-bill");
    expect(facts().bills.missed[0].missedDueDates).toEqual(["2026-07-05", "2026-08-05", "2026-09-05"]);
  });

  it("measures a month in progress against the same days of the months before it", () => {
    const pace = facts().anomalies.find((a) => a.kind === "pace");
    // September has spent 15,000 in its first six days; the baseline months had
    // spent 2,400 by the same day. That is 6.25x, which lands a 10,000 month
    // near 62,500 -- and it is a ratio between comparable windows, not this
    // month scaled up.
    expect(pace).toBeDefined();
    expect(pace?.baseline).toBe(10_000);
    expect(pace?.current).toBe(62_500);
    expect(pace?.changePct).toBe(525);
  });

  /**
   * The reason the comparison is clipped rather than projected. Spending is
   * front-loaded -- rent and the utilities all land in the first week -- so a
   * linear projection on day six multiplies one rent payment by five and cries
   * wolf every single month.
   */
  it("does not cry wolf over a month whose rent simply landed on the 1st", () => {
    const rentEveryMonth = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((m) =>
      tx({ localDate: `${m}-01`, amount: 22_000, categoryName: "Housing", description: "Rent" }));
    const f = buildAssessmentFacts({
      currency: "PHP",
      period: { from: "2026-09-01", to: "2026-09-30", label: "September 2026", granularity: "monthly" },
      today: "2026-09-06",
      timezoneOffset: -480,
      historyMonths: 6,
      transactions: [
        ...["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].flatMap((m) => spread(m, 25, { amount: 400 })),
        ...rentEveryMonth,
        ...spread("2026-09", 5, { amount: 400 }),
      ],
      bills: [],
    });
    // Linearly, 24,000 over six days projects to 120,000 against a 32,000 month.
    expect(f.anomalies.find((a) => a.kind === "pace")).toBeUndefined();
  });

  it("echoes the window it actually read", () => {
    expect(facts().window).toMatchObject({ from: "2026-04-01", months: 6 });
  });
});
