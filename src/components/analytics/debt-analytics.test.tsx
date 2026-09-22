import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Utilization, strategyVerdict } from "@/components/analytics/debt-analytics";
import { compareStrategies } from "@/lib/debt-payoff";

const money = (n: number) => `P${n}`;
const cleared = (months: number, totalInterest: number) => ({ order: ["a", "b"], months, totalInterest, stalled: false });
const stalled = { order: [], months: 0, totalInterest: 0, stalled: true };

describe("strategyVerdict", () => {
  /**
   * The bug, reached through the real race rather than a hand-built result. At 48% APR on 60,000
   * with 2,500 a month, highest-rate-first clears and smallest-balance-first never does. The panel
   * used to read the stalled run's zeros as a free result and say both orders "come out the same".
   */
  it("says only avalanche clears when snowball stalls, on the real divergent case", () => {
    const race = compareStrategies(
      [
        { id: "big", name: "Big", balance: 60000, apr: 48, minimumPct: null, minimumFloor: 100 },
        { id: "small", name: "Small", balance: 5000, apr: 0, minimumPct: null, minimumFloor: 100 },
      ],
      2500
    );
    expect(race).not.toBeNull();
    expect(race!.avalanche.stalled).toBe(false);
    expect(race!.snowball.stalled).toBe(true);

    const verdict = strategyVerdict(race!.avalanche, race!.snowball, money);
    expect(verdict).toMatch(/Only highest rate first clears/);
    expect(verdict).not.toMatch(/same/);
  });

  it("names smallest balance first when it is the only one that clears", () => {
    expect(strategyVerdict(stalled, cleared(40, 9000), money)).toMatch(/Only smallest balance first clears/);
  });

  /** Only when both stall is the amount, rather than the order, the whole story. */
  it("blames the amount only when neither order clears", () => {
    expect(strategyVerdict(stalled, stalled, money)).toMatch(/Neither order clears/);
  });

  it("reports the saving when both clear", () => {
    expect(strategyVerdict(cleared(30, 5000), cleared(33, 5600), money)).toBe(
      "Highest rate first saves about P600 and 3 months. Smallest balance first clears a card sooner, which some people find easier to keep going with."
    );
  });

  it("calls a tie a tie when both clear equally", () => {
    expect(strategyVerdict(cleared(30, 5000), cleared(30, 5000), money)).toMatch(/about the same/);
  });

  /**
   * The other way to be `stalled`: every month pays something down, but the race runs past fifty
   * years. Two large 0% balances paid 100 a month each make steady progress and still take about
   * eighty years. The verdict must say that neither clears in time, and must not claim a cause such
   * as a card outgrowing the payment, which is only true of the no-progress stall.
   */
  it("describes a race past the horizon without inventing a cause", () => {
    const race = compareStrategies(
      [
        { id: "a", name: "A", balance: 100000, apr: 0, minimumPct: null, minimumFloor: 100 },
        { id: "b", name: "B", balance: 90000, apr: 0, minimumPct: null, minimumFloor: 100 },
      ],
      200
    );
    expect(race!.avalanche.stalled).toBe(true);
    expect(race!.snowball.stalled).toBe(true);

    const verdict = strategyVerdict(race!.avalanche, race!.snowball, money);
    expect(verdict).toMatch(/within 50 years/);
    expect(verdict).not.toMatch(/outgrow|cover the interest/);
  });

  it("never names a cause when only one order clears", () => {
    expect(strategyVerdict(cleared(40, 9000), stalled, money)).not.toMatch(/outgrow|small card/);
  });
});


describe("Utilization", () => {
  /**
   * The whole reason the aggregate is nullable. A portfolio with no limit anywhere is not 0% used,
   * and a zero here would read as a person using none of their credit.
   */
  it("says the limit is not set rather than showing 0%", () => {
    render(<Utilization overall={null} />);
    expect(screen.getByText("Not set")).toBeDefined();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("shows the percentage with no caveat when every card has a limit", () => {
    render(<Utilization overall={{ percent: 38.3, counted: 3, omitted: 0 }} />);
    expect(screen.getByText("38.3%")).toBeDefined();
    expect(screen.queryByText(/with a limit set/)).toBeNull();
  });

  /** Both sides of the ratio use the counted cards only, so it must not imply it covers the rest. */
  it("names how many cards the figure covers when some were left out", () => {
    render(<Utilization overall={{ percent: 25, counted: 2, omitted: 1 }} />);
    expect(screen.getByText(/Across 2 cards with a limit set/)).toBeDefined();
    expect(screen.getByText(/1 card has none/)).toBeDefined();
  });

  /** Unclamped, matching utilizationOf: over the limit is the most useful thing it can say. */
  it("shows over 100% rather than clamping", () => {
    render(<Utilization overall={{ percent: 112.5, counted: 1, omitted: 0 }} />);
    expect(screen.getByText("112.5%")).toBeDefined();
  });
});
