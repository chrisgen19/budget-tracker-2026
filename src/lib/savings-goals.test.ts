import { describe, it, expect } from "vitest";
import { goalDayToInstant, summariseGoal, toGoalFacts, type GoalFacts } from "./savings-goals";
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
    // The 30 days from the first contribution, not the six months since creation - and 10,000 over
    // them, not 20,000. This is one monthly transfer; the opening deposit did not accrue over the
    // window it opens, and counting it reported this saver at 20,293.33 a month.
    expect(summary.pace.observedMonthly).toBe(10_146.67);
  });

  /**
   * Two deposits span one interval, not two. Counting the opening one divides N deposits by the
   * N-1 gaps between them, and the overstatement is what let a goal that was behind read as on
   * track - suppressing the `goal-off-pace` finding this whole feature exists to raise.
   */
  it("does not call a saver on track who is putting away less than is needed", () => {
    const summary = summariseGoal(
      goal({
        targetAmount: 100_000,
        targetDate: "2026-12-31",
        contributions: [put("2026-01-01", 5_000), put("2026-02-01", 5_000)],
      }),
      "2026-02-01",
    );
    // 5,000 a month going in against 8,227.03 needed.
    expect(summary.pace).toMatchObject({ observedMonthly: 4_909.68, state: "behind" });
    expect(detectGoalAnomalies([summary]).map((a) => a.kind)).toContain("goal-off-pace");
  });

  /** One contribution is an amount, not a rate - however many days ago it landed. */
  it("reports no rate from a single contribution made today", () => {
    const summary = summariseGoal(goal({ contributions: [put("2026-03-01", 10_000)] }), "2026-03-01");
    expect(summary.pace.observedMonthly).toBeNull();
  });

  /**
   * The opening day is excluded as a day, not as a row. Counting rows treats a second deposit made
   * the same morning as recurring funding, so an opening day nobody has added to since reports a
   * positive rate for as long as the goal exists - and can mark it on track, suppressing the
   * off-pace alert.
   */
  it("reports no rate from two contributions made on the same opening day", () => {
    const summary = summariseGoal(
      goal({
        targetAmount: 100_000,
        targetDate: "2026-12-31",
        contributions: [put("2026-01-01", 5_000), put("2026-01-01", 5_000)],
      }),
      "2026-02-01",
    );
    expect(summary.funded).toBe(10_000);
    expect(summary.pace).toMatchObject({ observedMonthly: null, state: "underway" });
    expect(detectGoalAnomalies([summary])).toEqual([]);
  });

  it("measures from the opening day once a later one exists, counting neither opening row", () => {
    const summary = summariseGoal(
      goal({
        targetAmount: 100_000,
        targetDate: "2026-12-31",
        contributions: [put("2026-01-01", 5_000), put("2026-01-01", 5_000), put("2026-02-01", 5_000)],
      }),
      "2026-02-01",
    );
    // 5,000 over the 31 days since the opening day - not 15,000, and not 10,000.
    expect(summary.pace.observedMonthly).toBe(4_909.68);
  });

  it("reports no rate from a single contribution made a day ago, rather than a month's worth", () => {
    const summary = summariseGoal(goal({ contributions: [put("2026-02-28", 10_000)] }), "2026-03-01");
    // Dividing one deposit by the one day since it landed reported 304,400 a month.
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

  /**
   * `stalled` asserts nothing has been put aside, so it is gated on the funded amount rather than
   * on a missing rate. Gating it on the rate put a "Not started" badge, and a Watchlist finding
   * reading "has nothing put aside yet", on a goal funded that morning - on the one day a saver is
   * most likely to be looking at it.
   */
  it("calls a goal funded today underway, not stalled", () => {
    const summary = summariseGoal(
      goal({ targetAmount: 5_000, targetDate: "2026-12-31", contributions: [put("2026-03-01", 1_200)] }),
      "2026-03-01",
    );
    expect(summary).toMatchObject({ funded: 1_200, fundedPct: 24 });
    expect(summary.pace).toMatchObject({ state: "underway", observedMonthly: null });
    // Neutral, so it raises nothing: there is no rate to act on and nothing has gone wrong.
    expect(detectGoalAnomalies([summary])).toEqual([]);
  });

  /** All of it came back out, so "nothing put aside" is the literal truth and the alert stands. */
  it("still calls a goal stalled when every contribution has been withdrawn again", () => {
    const summary = summariseGoal(
      goal({ targetDate: "2026-12-31", contributions: [put("2026-01-01", 5_000), put("2026-02-01", -5_000)] }),
      "2026-03-01",
    );
    expect(summary.funded).toBe(0);
    expect(summary.pace.state).toBe("stalled");
  });

  /**
   * A measured rate of zero is a finding, not a missing one: the goal holds money and has stopped
   * growing, so it arrives on no date at all. `behind`, and without a projection to name.
   */
  it("calls a goal that has stopped growing behind, with no completion date", () => {
    const summary = summariseGoal(
      goal({
        targetAmount: 100_000,
        targetDate: "2026-12-31",
        contributions: [put("2026-01-01", 10_000), put("2026-02-01", 2_000), put("2026-02-15", -2_000)],
      }),
      "2026-03-01",
    );
    expect(summary.pace).toMatchObject({ state: "behind", projectedCompletion: null });
    const [finding] = detectGoalAnomalies([summary]);
    expect(finding.kind).toBe("goal-off-pace");
    expect(finding.detail).toContain("arrives on no date at all");
    expect(finding.detail).not.toContain("null");
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
 * A target date and a contribution date are date-only values: "the 1st of March" means the 1st for
 * everyone. Storing them at midnight in the account's *current* timezone round-trips only while
 * that timezone never changes, and `users.timezone_offset` is a setting.
 */
describe("goalDayToInstant", () => {
  it("stores a calendar day at midnight UTC, the convention bills already use", () => {
    expect(goalDayToInstant("2026-03-01").toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  /**
   * The failure this replaces: written at UTC+8 the day landed on `2026-02-28T16:00Z`, and read
   * back at UTC-5 it was 28 February. The deadline, the contribution history and every pace figure
   * over them moved a day because somebody travelled.
   */
  it("reads a stored day back as itself whatever the account's offset has become", () => {
    const stored = goalDayToInstant("2026-03-01");
    const row = {
      id: "g1",
      name: "House deposit",
      kind: "GOAL",
      status: "ACTIVE",
      targetAmount: 120_000,
      targetDate: stored,
      notes: null,
      createdAt: new Date("2026-01-01T03:00:00.000Z"),
      contributions: [{ id: "c1", amount: 1_000, date: stored, note: null }],
    };

    // UTC+8, UTC, UTC-5 and UTC-12 by the getTimezoneOffset convention the whole app uses.
    for (const timezoneOffset of [-480, 0, 300, 720]) {
      const facts = toGoalFacts(row, timezoneOffset);
      expect(facts.targetDate).toBe("2026-03-01");
      expect(facts.contributions[0].date).toBe("2026-03-01");
    }
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
