import { describe, expect, it } from "vitest";
import {
  auditScheduledLabels,
  computeHygiene,
  findClockSlips,
  findUnderLoggedCategories,
  type FactLabelSchedule,
  type FactTransaction,
} from "./assessment-facts";

/**
 * Three accuracy checks the coverage gate cannot make, found by hand on the owner's account in
 * September 2026 before they existed here: a July backfilled from ride history that passed the gate
 * with 18 meals against a usual 52, a Work Budget schedule tagging Netflix and maintenance medicine
 * because they were logged in office hours, and two commutes typed as 04:xx instead of 16:xx.
 */

let seq = 0;
const tx = (over: Partial<FactTransaction> & { localDate: string; amount?: number }): FactTransaction => ({
  id: `t${(seq += 1)}`,
  amount: 100,
  type: "EXPENSE",
  description: "thing",
  categoryId: "c1",
  categoryName: "Food & Dining",
  billId: null,
  labelCount: 0,
  ...over,
});

/** `count` rows of `amount` each in `month`, one per day from the 1st. */
const rows = (month: string, count: number, amount: number, over: Partial<FactTransaction> = {}): FactTransaction[] =>
  Array.from({ length: count }, (_, i) =>
    tx({ localDate: `${month}-${String((i % 28) + 1).padStart(2, "0")}`, amount, ...over }));

const TRUSTED = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

describe("findUnderLoggedCategories", () => {
  it("flags a trusted month whose rows and total both collapse against the other months", () => {
    const data = [
      ...rows("2026-03", 50, 300), ...rows("2026-04", 52, 300), ...rows("2026-05", 55, 300), ...rows("2026-06", 50, 300),
      ...rows("2026-07", 18, 220),
    ];
    expect(findUnderLoggedCategories(data, TRUSTED)).toEqual([
      { month: "2026-07", category: "Food & Dining", count: 18, typicalCount: 51, total: 3960, typicalTotal: 15300 },
    ]);
  });

  it("leaves a month alone when only one of the two falls: cheaper meals, or fewer bigger shops", () => {
    const cheaper = [...rows("2026-03", 50, 300), ...rows("2026-04", 50, 300), ...rows("2026-05", 50, 300), ...rows("2026-06", 48, 100)];
    expect(findUnderLoggedCategories(cheaper, TRUSTED.slice(0, 4))).toEqual([]);

    const fewerBigger = [...rows("2026-03", 8, 1000), ...rows("2026-04", 8, 1000), ...rows("2026-05", 8, 1000), ...rows("2026-06", 2, 4000)];
    expect(findUnderLoggedCategories(fewerBigger, TRUSTED.slice(0, 4))).toEqual([]);
  });

  it("zero-fills, so a category missing for a whole trusted month is still found", () => {
    const data = [...rows("2026-03", 6, 500), ...rows("2026-04", 6, 500), ...rows("2026-05", 6, 500), ...rows("2026-06", 1, 1000)];
    const other = rows("2026-07", 6, 500, { categoryName: "Groceries" });
    const found = findUnderLoggedCategories([...data, ...other, ...rows("2026-03", 5, 500, { categoryName: "Groceries" }),
      ...rows("2026-04", 5, 500, { categoryName: "Groceries" }), ...rows("2026-05", 5, 500, { categoryName: "Groceries" })], TRUSTED);
    expect(found.map((x) => `${x.month} ${x.category} ${x.count}`)).toEqual(expect.arrayContaining(["2026-07 Food & Dining 0", "2026-06 Groceries 0"]));
  });

  it("needs three trusted months besides the one it judges", () => {
    const data = [...rows("2026-03", 50, 300), ...rows("2026-04", 50, 300), ...rows("2026-05", 5, 300)];
    expect(findUnderLoggedCategories(data, ["2026-03", "2026-04", "2026-05"])).toEqual([]);
  });

  it("ignores a category that is usually too rare for a thin month to mean anything", () => {
    const data = [...rows("2026-03", 3, 900), ...rows("2026-04", 3, 900), ...rows("2026-05", 3, 900), ...rows("2026-06", 0, 0)];
    expect(findUnderLoggedCategories(data, TRUSTED.slice(0, 4))).toEqual([]);
  });

  it("leaves a lumpy category's quiet month alone: that is behaviour, not a gap", () => {
    // Fun on the owner's account, which read as under-logged in May before the steadiness check.
    const counts: Array<[string, number]> = [["2026-04", 10], ["2026-05", 1], ["2026-06", 2], ["2026-07", 0], ["2026-08", 13]];
    const data = counts.flatMap(([m, n]) => rows(m, n, 250, { categoryName: "Fun" }));
    expect(findUnderLoggedCategories(data, counts.map(([m]) => m))).toEqual([]);
  });

  it("still finds two thin months in a row, which the lowest month alone would excuse", () => {
    const counts: Array<[string, number]> = [["2026-02", 6], ["2026-03", 7], ["2026-04", 6], ["2026-05", 9], ["2026-06", 1], ["2026-07", 1], ["2026-08", 8]];
    const data = counts.flatMap(([m, n]) => rows(m, n, 1000, { categoryName: "Groceries" }));
    const found = findUnderLoggedCategories(data, counts.map(([m]) => m));
    expect(found.map((x) => x.month).sort()).toEqual(["2026-06", "2026-07"]);
  });

  it("judges only trusted months, never an excluded or running one", () => {
    const data = [...rows("2026-03", 50, 300), ...rows("2026-04", 50, 300), ...rows("2026-05", 50, 300), ...rows("2026-06", 50, 300),
      ...rows("2026-08", 3, 300)];
    expect(findUnderLoggedCategories(data, TRUSTED.slice(0, 4))).toEqual([]);
  });

  it("ranks by money missing, not by how far the share fell", () => {
    const food = [...rows("2026-03", 50, 300), ...rows("2026-04", 50, 300), ...rows("2026-05", 50, 300), ...rows("2026-06", 10, 300)];
    const fun = ["2026-03", "2026-04", "2026-05"].flatMap((m) => rows(m, 5, 100, { categoryName: "Fun" }));
    const found = findUnderLoggedCategories([...food, ...fun], TRUSTED.slice(0, 4));
    expect(found.map((x) => x.category)).toEqual(["Food & Dining", "Fun"]);
  });

  it("reads expenses only", () => {
    const data = TRUSTED.slice(0, 3).flatMap((m) => rows(m, 5, 30000, { type: "INCOME", categoryName: "Salary" }));
    expect(findUnderLoggedCategories(data, TRUSTED.slice(0, 4))).toEqual([]);
  });
});

const WORK: FactLabelSchedule = {
  labelId: "work", labelName: "Work Budget", applicableTo: "EXPENSE", days: [1, 2, 3, 4, 5], startTime: "05:00", endTime: "17:00",
};
// 2026-09-07 is a Monday; 2026-09-12 a Saturday.
const labelled = (localDate: string, localTime: string, categoryName: string, amount = 100): FactTransaction =>
  tx({ localDate, localTime, categoryName, amount, labelIds: ["work"], labelCount: 1 });

describe("auditScheduledLabels", () => {
  it("names the categories a label reaches only inside its window, and how many rows the window covers", () => {
    const data = [
      labelled("2026-09-07", "09:00", "Subscriptions", 449),
      labelled("2026-09-08", "12:00", "Subscriptions", 279),
      labelled("2026-09-08", "07:00", "Transportation"),
      labelled("2026-09-08", "18:30", "Transportation"),
    ];
    expect(auditScheduledLabels(data, [WORK])).toEqual([{
      label: "Work Budget",
      window: "Mon–Fri 05:00–17:00",
      rows: 4,
      inWindow: 3,
      clockOnly: [{ category: "Subscriptions", count: 2, total: 728 }],
    }]);
  });

  it("counts a weekend row and a row at the end time as outside, as auto-apply does", () => {
    const data = [labelled("2026-09-12", "10:00", "Fun"), labelled("2026-09-07", "17:00", "Fun"), labelled("2026-09-07", "16:59", "Fun")];
    const [audit] = auditScheduledLabels(data, [WORK]);
    expect(audit.inWindow).toBe(1);
    expect(audit.clockOnly).toEqual([]);
  });

  it("needs two sightings before a category is reported", () => {
    const [audit] = auditScheduledLabels([labelled("2026-09-07", "10:00", "Healthcare")], [WORK]);
    expect(audit.clockOnly).toEqual([]);
  });

  it("skips rows with no time rather than judging them, and omits a label nothing carries", () => {
    const untimed = tx({ localDate: "2026-09-07", labelIds: ["work"], labelCount: 1 });
    expect(auditScheduledLabels([untimed], [WORK])).toEqual([]);
    expect(auditScheduledLabels([labelled("2026-09-07", "10:00", "Fun")], [])).toEqual([]);
  });

  it("describes a label with several rules, and short runs of days by name", () => {
    const weekend: FactLabelSchedule = { ...WORK, days: [0, 6], startTime: "08:00", endTime: "12:00" };
    const [audit] = auditScheduledLabels([labelled("2026-09-12", "09:00", "Fun")], [WORK, weekend]);
    expect(audit.window).toBe("Mon–Fri 05:00–17:00; Sun, Sat 08:00–12:00");
    expect(audit.inWindow).toBe(1);
  });

  it("treats a row of the wrong type for the label's schedule as outside it", () => {
    const income = tx({ localDate: "2026-09-07", localTime: "10:00", type: "INCOME", labelIds: ["work"], labelCount: 1 });
    expect(auditScheduledLabels([income], [WORK])[0].inWindow).toBe(0);
  });
});

describe("findClockSlips", () => {
  const timed = (localTime: string, loggedMinutesAfter: number) =>
    tx({ localDate: "2026-05-11", localTime, loggedMinutesAfter, description: " Jeep & UV ", amount: 48 });

  it("finds a small-hours row written twelve hours later, and says when it was written", () => {
    const slip = timed("04:36", 720);
    expect(findClockSlips([slip])).toEqual([{
      transactionId: slip.id, date: "2026-05-11", time: "04:36", loggedAt: "16:36", description: "Jeep & UV", amount: 48,
    }]);
  });

  it("allows ten minutes either side of twelve hours and no more", () => {
    expect(findClockSlips([timed("04:58", 730), timed("04:58", 710)])).toHaveLength(2);
    expect(findClockSlips([timed("04:58", 731), timed("04:58", 709)])).toEqual([]);
  });

  it("leaves a daytime row alone: a 06:07 ride logged at 18:07 is a morning ride logged at night", () => {
    expect(findClockSlips([timed("06:07", 720)])).toEqual([]);
  });

  it("leaves a real late night alone, and rows missing either field", () => {
    expect(findClockSlips([timed("00:09", 1801)])).toEqual([]);
    expect(findClockSlips([tx({ localDate: "2026-05-11", localTime: "04:36" }), tx({ localDate: "2026-05-11", loggedMinutesAfter: 720 })])).toEqual([]);
  });
});

describe("computeHygiene data-quality fields", () => {
  it("passes the schedules through, and reports nothing to audit without them", () => {
    const data = [labelled("2026-09-07", "09:00", "Subscriptions"), labelled("2026-09-08", "09:00", "Subscriptions")];
    const period = { from: "2026-09-01", to: "2026-09-30" };
    expect(computeHygiene(data, [], period, [WORK]).scheduledLabels[0].clockOnly).toHaveLength(1);
    const bare = computeHygiene(data, [], period);
    expect(bare.scheduledLabels).toEqual([]);
    expect(bare.underLogged).toEqual([]);
    expect(bare.clockSlips).toEqual([]);
  });
});
