import { describe, it, expect } from "vitest";
import { goalDayToInstant, summariseGoal, type GoalFacts } from "./savings-goals";
import { detectGoalAnomalies } from "./assessment-facts";

const goal = (over: Partial<GoalFacts> = {}): GoalFacts => ({
  id: "g1",
  name: "House deposit",
  kind: "GOAL",
  status: "ACTIVE",
  targetAmount: 120_000,
  targetDate: "2027-01-01",
  notes: null,
  createdOn: "2026-01-01",
  contributions: [],
  ...over,
});

let seq = 0;
const put = (date: string, amount: number) => ({
  id: `c${(seq += 1)}`,
  amount,
  date,
  note: null,
});

describe("summariseGoal", () => {
  /**
   * The point of the whole model. A month where nothing was spent is not a month where the deposit
   * got closer, and every figure here comes from rows the user assigned on purpose.
   */
  it("funds a goal only from its contributions", () => {
    const summary = summariseGoal(goal({ contributions: [put("2026-02-01", 20_000)] }), "2026-03-01");
    expect(summary).toMatchObject({ funded: 20_000, fundedPct: 17, contributionCount: 1 });
  });

  /** One signed column: a withdrawal is a negative row, so funded is just their sum. */
  it("takes a withdrawal back out of the funded amount", () => {
    const summary = summariseGoal(
      goal({ contributions: [put("2026-02-01", 20_000), put("2026-03-01", -5_000)] }),
      "2026-04-01",
    );
    expect(summary.funded).toBe(15_000);
  });

  it("reports a goal that has reached its target as funded", () => {
    const summary = summariseGoal(
      goal({ targetAmount: 10_000, contributions: [put("2026-02-01", 10_000)] }),
      "2026-03-01",
    );
    expect(summary.pace.state).toBe("funded");
    expect(summary.pace.remaining).toBe(0);
  });

  /** The bar is clamped; the figure is not, so an over-funded goal is still visible as one. */
  it("clamps the progress bar without rounding the real figure down", () => {
    const summary = summariseGoal(
      goal({ targetAmount: 10_000, contributions: [put("2026-02-01", 12_000)] }),
      "2026-03-01",
    );
    expect(summary).toMatchObject({ funded: 12_000, fundedPct: 100 });
  });

  /**
   * A goal set up in January and first funded in June has been running one month, not six.
   * Measuring from `createdOn` condemns a saver who is perfectly on track.
   */
  it("measures the observed rate from the first contribution, not from when the goal was made", () => {
    const summary = summariseGoal(
      goal({
        createdOn: "2026-01-01",
        contributions: [put("2026-06-01", 10_000), put("2026-07-01", 10_000)],
      }),
      "2026-07-01",
    );
    // 20,000 over the 30 days from the first contribution, not over the six months since creation.
    expect(summary.pace.observedMonthly).toBe(20_293.33);
  });

  /** One contribution is an amount, not a rate. */
  it("reports no rate from a single contribution made today", () => {
    const summary = summariseGoal(goal({ contributions: [put("2026-03-01", 10_000)] }), "2026-03-01");
    expect(summary.pace.observedMonthly).toBeNull();
  });

  it("calls a goal on track when it is going in faster than it needs to", () => {
    const summary = summariseGoal(
      goal({
        targetAmount: 120_000,
        targetDate: "2026-12-31",
        contributions: [put("2026-01-01", 30_000), put("2026-02-01", 30_000), put("2026-03-01", 30_000)],
      }),
      "2026-03-01",
    );
    expect(summary.pace.state).toBe("on-track");
  });

  it("calls a goal behind when the rate will not reach the target in time", () => {
    const summary = summariseGoal(
      goal({
        targetAmount: 120_000,
        targetDate: "2026-12-31",
        contributions: [put("2026-01-01", 2_000), put("2026-02-01", 2_000), put("2026-03-01", 2_000)],
      }),
      "2026-03-01",
    );
    expect(summary.pace).toMatchObject({ state: "behind", requiredMonthly: 11_377.57 });
    expect(summary.pace.projectedCompletion).not.toBeNull();
  });

  /** A monthly transfer is behind for twenty-nine days out of thirty by any exact reading. */
  it("allows a small shortfall rather than calling a monthly transfer behind every day", () => {
    const summary = summariseGoal(
      goal({
        targetAmount: 100_000,
        targetDate: "2026-11-01",
        contributions: [put("2026-01-01", 10_000), put("2026-02-01", 9_600)],
      }),
      "2026-02-01",
    );
    expect(summary.pace.state).toBe("on-track");
  });

  it("separates a goal with a deadline and nothing in it from one merely behind", () => {
    expect(summariseGoal(goal({ targetDate: "2026-12-31" }), "2026-03-01").pace.state).toBe("stalled");
  });

  it("reports a goal past its date and still short as overdue", () => {
    const summary = summariseGoal(
      goal({ targetDate: "2026-02-01", contributions: [put("2026-01-01", 1_000)] }),
      "2026-03-01",
    );
    expect(summary.pace).toMatchObject({ state: "overdue", requiredMonthly: null });
  });

  /**
   * Pace against no deadline is a category error, not a conservative estimate, and returning a
   * reassuring "on track" would be the worst of the available answers.
   */
  it("reports progress but not pace for a goal with no target date", () => {
    const summary = summariseGoal(
      goal({ targetDate: null, contributions: [put("2026-01-01", 10_000)] }),
      "2026-03-01",
    );
    expect(summary.pace).toMatchObject({
      state: "no-deadline",
      requiredMonthly: null,
      daysRemaining: null,
      projectedCompletion: null,
    });
    expect(summary.pace.remaining).toBe(110_000);
  });
});

/**
 * A bare date is midnight UTC, which is the previous day for anyone west of Greenwich. A target
 * date stored a day early moves every pace figure that reads it.
 */
describe("goalDayToInstant", () => {
  it("stores a calendar day at the start of that day in the user's own timezone", () => {
    // UTC+8 is -480 by the getTimezoneOffset convention the whole app uses.
    expect(goalDayToInstant("2026-03-01", -480).toISOString()).toBe("2026-02-28T16:00:00.000Z");
  });
});

describe("detectGoalAnomalies", () => {
  const summarise = (over: Partial<GoalFacts>, today = "2026-03-01") =>
    summariseGoal(goal(over), today);

  it("raises a goal being funded too slowly, and says by how much", () => {
    const behind = summarise({
      targetAmount: 120_000,
      targetDate: "2026-12-31",
      contributions: [put("2026-01-01", 2_000), put("2026-02-01", 2_000)],
    });
    const [finding] = detectGoalAnomalies([behind]);
    expect(finding).toMatchObject({ kind: "goal-off-pace", scope: "outstanding", severity: "medium" });
    expect(finding.drillDown).toEqual({ destination: "goals" });
    expect(finding.detail).toContain("needs");
  });

  it("separates a goal nobody has started from one merely behind", () => {
    const [finding] = detectGoalAnomalies([summarise({ targetDate: "2026-12-31" })]);
    expect(finding.kind).toBe("goal-stalled");
    expect(finding.title).toContain("nothing put aside");
  });

  /** A goal past its date cannot be fixed by any amount of saving, and the page already says so. */
  it("stays quiet about a funded, overdue or deadline-free goal", () => {
    const quiet = [
      summarise({ targetAmount: 10_000, contributions: [put("2026-01-01", 10_000)] }),
      summarise({ targetDate: "2026-02-01", contributions: [put("2026-01-01", 1_000)] }),
      summarise({ targetDate: null, contributions: [put("2026-01-01", 1_000)] }),
    ];
    expect(detectGoalAnomalies(quiet)).toEqual([]);
  });

  it("leaves an archived goal out of the Watchlist", () => {
    const archived = summarise({ status: "ARCHIVED", targetDate: "2026-12-31" });
    expect(detectGoalAnomalies([archived])).toEqual([]);
  });

  /** A contribution must not make the finding it fixes reappear as a new one under a new key. */
  it("keys a finding on the goal and its deadline rather than on the rate", () => {
    const slower = summarise({
      targetAmount: 120_000,
      targetDate: "2026-12-31",
      contributions: [put("2026-01-01", 2_000), put("2026-02-01", 2_000)],
    });
    const slowerStill = summarise({
      targetAmount: 120_000,
      targetDate: "2026-12-31",
      contributions: [put("2026-01-01", 2_000), put("2026-02-01", 2_500)],
    });
    expect(detectGoalAnomalies([slower])[0].stateKey).toBe(detectGoalAnomalies([slowerStill])[0].stateKey);
  });
});
