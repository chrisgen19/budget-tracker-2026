import { describe, expect, it } from "vitest";
import {
  buildAssessmentFacts,
  foldDescription,
  isSlowRecurring,
  type FactTransaction,
  type HistoryCharge,
} from "./assessment-facts";

/**
 * #360: quarterly and yearly subscriptions never reached the recurring-charge findings.
 *
 * The window-based gate needed four distinct months, which a six-month window cannot hold for a
 * quarterly charge and no window can hold for a yearly one (four sightings is four years). These
 * charges now establish on a steady cadence across the whole history instead.
 */

let seq = 0;
const tx = (localDate: string, amount: number, description = "Groceries"): FactTransaction => ({
  id: `t${(seq += 1)}`,
  type: "EXPENSE",
  amount,
  localDate,
  description,
  categoryId: "c1",
  categoryName: "Subscriptions",
  billId: null,
  labelCount: 1,
});

const history = (description: string, rows: Array<[string, number]>): Map<string, HistoryCharge[]> =>
  new Map([[foldDescription(description), rows.map(([day, amount]) => ({ day, amount, description }))]]);

/** A report on `today`'s month, with the default six-month window and some ordinary spending. */
const factsOn = (
  today: string,
  historyCharges: Map<string, HistoryCharge[]>,
  transactions: FactTransaction[] = []
) =>
  buildAssessmentFacts({
    currency: "PHP",
    period: { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-28`, label: "period", granularity: "monthly" },
    today,
    timezoneOffset: -480,
    historyMonths: 6,
    transactions,
    bills: [],
    historyCharges,
  });

const kinds = (facts: ReturnType<typeof factsOn>) => facts.anomalies.map((finding) => finding.kind);
const charge = (day: string, amount: number) => ({ day, amount });

describe("isSlowRecurring", () => {
  it("accepts a yearly charge seen twice a year apart", () => {
    expect(isSlowRecurring([charge("2024-09-14", 4990), charge("2025-09-14", 4990)], "2026-09-10")).toBe(true);
  });

  /**
   * The false positives the first version produced on real data, kept as they were. Two meals bought
   * about three months apart are a habit, not a quarterly subscription: the snack was then reported
   * as "repriced by 34%" and the order as "renewing around 28 September".
   */
  it("rejects a usual meal bought twice about a quarter apart", () => {
    expect(isSlowRecurring([charge("2026-02-26", 58), charge("2026-06-03", 78)], "2026-09-10")).toBe(false);
    expect(isSlowRecurring([charge("2026-04-07", 160), charge("2026-07-03", 165)], "2026-09-10")).toBe(false);
  });

  it("rejects any pair that is not about a year apart", () => {
    expect(isSlowRecurring([charge("2026-04-05", 899), charge("2026-07-05", 899)], "2026-09-10")).toBe(false);
    expect(isSlowRecurring([charge("2025-11-01", 1200), charge("2026-07-10", 1200)], "2026-09-10")).toBe(false);
  });

  /** A yearly subscription renews on almost the same date; a gap weeks off a year is coincidence. */
  it("holds a yearly pair to within a few weeks of a year", () => {
    expect(isSlowRecurring([charge("2025-01-10", 4990), charge("2026-01-25", 4990)], "2026-06-01")).toBe(true);
    expect(isSlowRecurring([charge("2025-01-10", 4990), charge("2026-03-01", 4990)], "2026-06-01")).toBe(false);
  });

  it("establishes a quarterly charge on its third sighting", () => {
    const run = [charge("2026-01-05", 899), charge("2026-04-05", 899), charge("2026-07-05", 899)];
    expect(isSlowRecurring(run, "2026-09-10")).toBe(true);
  });

  it("rejects amounts too far apart to be one subscription", () => {
    expect(isSlowRecurring([charge("2025-09-14", 300), charge("2026-09-01", 2500)], "2026-09-10")).toBe(false);
  });

  it("rejects an irregular run of three", () => {
    const run = [charge("2025-01-10", 500), charge("2025-03-15", 500), charge("2025-11-20", 500)];
    expect(isSlowRecurring(run, "2026-01-10")).toBe(false);
  });

  it("accepts a steady run of three at any slow cycle", () => {
    const run = [charge("2025-01-10", 500), charge("2025-05-12", 500), charge("2025-09-10", 500)];
    expect(isSlowRecurring(run, "2025-11-01")).toBe(true);
  });

  /** Monthly and faster stays with the window, where it always was. */
  it("leaves a monthly cadence to the window", () => {
    expect(isSlowRecurring([charge("2026-06-01", 499), charge("2026-07-01", 499), charge("2026-08-01", 499)], "2026-09-10"))
      .toBe(false);
  });

  /** A yearly subscription cancelled three years ago is not news. */
  it("drops a charge last seen more than three of its cycles ago", () => {
    expect(isSlowRecurring([charge("2022-06-01", 4990), charge("2023-06-01", 4990)], "2026-09-10")).toBe(false);
  });
});

describe("slow subscriptions reach the recurring findings", () => {
  const adobe = history("Adobe Creative Cloud", [["2024-09-14", 4990], ["2025-09-14", 4990]]);

  /**
   * The issue's own reproduction. Both sightings are older than the six-month window, which is the
   * ordinary state of a yearly subscription just before it renews -- precisely when "cancel it
   * before then" is worth saying.
   */
  it("warns before a yearly charge renews, though nothing of it is in the window", () => {
    const facts = factsOn("2026-09-10", adobe);
    const found = facts.anomalies.find((finding) => finding.kind === "recurring-renews-soon");
    expect(found?.title).toContain("2026-09-14");
    expect(found?.scope).toBe("outstanding");
  });

  it("is missing entirely without the whole-history read", () => {
    expect(kinds(factsOn("2026-09-10", new Map()))).not.toContain("recurring-renews-soon");
  });

  it("warns before a quarterly charge renews", () => {
    const quarterly = history("Spotify Family", [["2026-01-05", 899], ["2026-04-05", 899], ["2026-07-05", 899]]);
    const found = factsOn("2026-09-30", quarterly).anomalies.find((f) => f.kind === "recurring-renews-soon");
    expect(found).toBeDefined();
  });

  /** One whole cycle overdue, as for any cadence: a yearly charge is stopped after a year, not four days. */
  it("reports a yearly charge a whole cycle past due as stopped", () => {
    const lapsed = history("Adobe Creative Cloud", [["2023-09-14", 4990], ["2024-09-14", 4990]]);
    expect(kinds(factsOn("2026-09-20", lapsed))).toContain("recurring-ended");
  });

  it("does not call a yearly charge stopped a few days after its date", () => {
    expect(kinds(factsOn("2026-09-20", adobe))).not.toContain("recurring-ended");
  });

  it("reports a yearly price rise", () => {
    const repriced = history("Adobe Creative Cloud", [["2024-09-14", 4990], ["2025-09-14", 6490]]);
    const found = factsOn("2026-05-01", repriced).anomalies.find((f) => f.kind === "recurring-amount-change");
    expect(found?.changePct).toBeGreaterThan(20);
  });

  it("marks the item established and keeps its whole-history cadence", () => {
    const item = factsOn("2026-09-10", adobe).recurring.items.find((i) => i.description === "Adobe Creative Cloud");
    expect(item).toMatchObject({ established: true, intervalDays: 365, lastSeen: "2025-09-14", expectedNextDate: "2026-09-14" });
  });

  /**
   * The monthly base divided a charge's total by the months it appeared in. For a yearly 4,990 seen
   * in one month that is 4,990 a month; priced by its own cycle it is about 416.
   */
  it("adds a yearly charge to the monthly base at its monthly cost", () => {
    const facts = factsOn("2026-09-10", adobe);
    expect(facts.recurring.monthlyBase).toBeGreaterThan(400);
    expect(facts.recurring.monthlyBase).toBeLessThan(430);
  });

  /** The directional cash forecast reads the same items, so a renewal is a claim on cash too. */
  it("counts a yearly renewal as an upcoming claim in the cash forecast", () => {
    const claims = factsOn("2026-09-10", adobe).forecast.claims;
    expect(claims).toContainEqual(expect.objectContaining({ date: "2026-09-14", amount: 4990, source: "recurring" }));
  });

  /** The real case, end to end: no renewal and no price change for a meal bought twice. */
  it("says nothing about a meal bought twice a quarter apart", () => {
    const meals = new Map([
      ...history("7-Eleven - Hot Chocolate and Banana", [["2026-02-26", 58], ["2026-06-03", 78]]),
      ...history("Mang Inasal - Pecho Lrg 1R", [["2026-04-07", 160], ["2026-07-03", 165]]),
    ]);
    const found = kinds(factsOn("2026-09-24", meals));
    expect(found).not.toContain("recurring-renews-soon");
    expect(found).not.toContain("recurring-amount-change");
  });
});

describe("monthly charges are unchanged", () => {
  /**
   * The history read is for slow cadences only. A monthly subscription handed to it as well must
   * come out exactly as the window alone describes it.
   */
  it("describes a monthly charge the same with or without its history", () => {
    const days = ["2026-04-03", "2026-05-03", "2026-06-03", "2026-07-03", "2026-08-03"];
    const window = days.map((day) => tx(day, 499, "Netflix"));
    const withHistory = factsOn("2026-08-10", history("Netflix", days.map((day) => [day, 499])), window);
    const without = factsOn("2026-08-10", new Map(), window);
    expect(withHistory.recurring.items).toEqual(without.recurring.items);
    expect(withHistory.recurring.monthlyBase).toBe(without.recurring.monthlyBase);
  });

  it("still establishes a monthly charge on four months of the window", () => {
    const window = ["2026-04-03", "2026-05-03", "2026-06-03", "2026-07-03"].map((day) => tx(day, 499, "Netflix"));
    const item = factsOn("2026-07-10", new Map(), window).recurring.items.find((i) => i.description === "Netflix");
    expect(item?.established).toBe(true);
  });

  it("does not establish a monthly charge seen in only two months", () => {
    const window = ["2026-06-03", "2026-07-03"].map((day) => tx(day, 499, "Netflix"));
    const item = factsOn("2026-07-10", new Map(), window).recurring.items.find((i) => i.description === "Netflix");
    expect(item?.established ?? false).toBe(false);
  });
});
