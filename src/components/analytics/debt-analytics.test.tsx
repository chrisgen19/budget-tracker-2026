import { describe, expect, it } from "vitest";
import { strategyVerdict } from "@/components/analytics/debt-analytics";
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
});
