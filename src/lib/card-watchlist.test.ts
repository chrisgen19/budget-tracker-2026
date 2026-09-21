import { describe, expect, it } from "vitest";
import { detectCardAnomalies, type CardWatchFacts } from "@/lib/assessment-facts";

const TODAY = "2026-09-21";

const card = (over: Partial<CardWatchFacts> = {}): CardWatchFacts => ({
  id: "card_1",
  name: "BPI Gold",
  balance: 20_000,
  utilization: 10,
  apr: 36,
  dueDay: null,
  interestEverLogged: true,
  recentPayments: [],
  today: TODAY,
  ...over,
});

const kinds = (facts: CardWatchFacts[]) => detectCardAnomalies(facts).map((finding) => finding.kind);

describe("detectCardAnomalies", () => {
  /** A settled card has no utilization worth reporting and no payment to chase. */
  it("says nothing about a card that owes nothing", () => {
    expect(detectCardAnomalies([card({ balance: 0, utilization: 95, apr: 36, interestEverLogged: false })])).toEqual([]);
    expect(detectCardAnomalies([card({ balance: -500, utilization: 95 })])).toEqual([]);
  });

  it("scopes every card finding as outstanding, never to the period", () => {
    const findings = detectCardAnomalies([
      card({ utilization: 80, apr: 36, interestEverLogged: false, dueDay: 23 }),
    ]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.scope === "outstanding")).toBe(true);
  });

  it("sends every card finding to that card, not to the list", () => {
    const findings = detectCardAnomalies([card({ utilization: 80 })]);
    expect(findings[0].drillDown).toEqual({ destination: "cards", cardId: "card_1" });
  });

  describe("interest never logged", () => {
    /**
     * The finding that protects every other figure: `computeAccountBalance` knows nothing about
     * interest, so while none is logged the derived balance drifts below the statement each cycle.
     */
    it("fires for a card carrying a balance at a real APR", () => {
      expect(kinds([card({ apr: 36, interestEverLogged: false })])).toContain("card-interest-untracked");
    });

    it("stays quiet once any interest has been logged", () => {
      expect(kinds([card({ apr: 36, interestEverLogged: true })])).not.toContain("card-interest-untracked");
    });

    /**
     * Without an APR there is no evidence the card charges interest at all, and a card paid in full
     * every month should not be nagged about a cost it does not have.
     */
    it("stays quiet with no APR recorded", () => {
      expect(kinds([card({ apr: null, interestEverLogged: false })])).not.toContain("card-interest-untracked");
    });

    /** A genuine 0% plan accrues nothing, so there is nothing missing. */
    it("stays quiet on a 0% plan", () => {
      expect(kinds([card({ apr: 0, interestEverLogged: false })])).not.toContain("card-interest-untracked");
    });
  });

  describe("utilization", () => {
    it("fires at or above 30% of the limit", () => {
      expect(kinds([card({ utilization: 30 })])).toContain("card-utilization-high");
      expect(kinds([card({ utilization: 29.9 })])).not.toContain("card-utilization-high");
    });

    it("escalates past 90%", () => {
      const [finding] = detectCardAnomalies([card({ utilization: 95 })]);
      expect(finding.severity).toBe("high");
    });

    it("says nothing without a limit to measure against", () => {
      expect(kinds([card({ utilization: null })])).not.toContain("card-utilization-high");
    });

    /**
     * Bucketed to ten points, so a balance drifting 61% to 62% does not re-raise a finding the user
     * has resolved, while crossing into a new band is a new fact and does.
     */
    it("keeps one state key across small drifts and changes it across a band", () => {
      const at61 = detectCardAnomalies([card({ utilization: 61 })])[0].stateKey;
      const at62 = detectCardAnomalies([card({ utilization: 62 })])[0].stateKey;
      const at71 = detectCardAnomalies([card({ utilization: 71 })])[0].stateKey;
      expect(at62).toBe(at61);
      expect(at71).not.toBe(at61);
    });
  });

  describe("paying only the minimum", () => {
    const min = (amount: number, minimumThen: number | null) => ({ amount, minimumThen });

    it("fires after three consecutive minimum-sized payments", () => {
      const payments = [min(1000, 1000), min(1000, 1000), min(1000, 1000)];
      expect(kinds([card({ recentPayments: payments })])).toContain("card-minimum-only");
    });

    /** Two is a tight couple of months, not a pattern. */
    it("stays quiet below three", () => {
      const payments = [min(1000, 1000), min(1000, 1000)];
      expect(kinds([card({ recentPayments: payments })])).not.toContain("card-minimum-only");
    });

    it("stays quiet when one of the three was a real payment", () => {
      const payments = [min(1000, 1000), min(8000, 1000), min(1000, 1000)];
      expect(kinds([card({ recentPayments: payments })])).not.toContain("card-minimum-only");
    });

    /** Rounding up, or adding a little, should not hide the pattern. */
    it("tolerates paying a little over the minimum", () => {
      const payments = [min(1020, 1000), min(1050, 1000), min(1000, 1000)];
      expect(kinds([card({ recentPayments: payments })])).toContain("card-minimum-only");
    });

    /** With no minimum recorded there is nothing to compare against, so it asserts nothing. */
    it("stays quiet when the minimum is unknown", () => {
      const payments = [min(1000, null), min(1000, null), min(1000, null)];
      expect(kinds([card({ recentPayments: payments })])).not.toContain("card-minimum-only");
    });

    it("judges only the most recent three", () => {
      const payments = [min(9000, 1000), min(1000, 1000), min(1000, 1000), min(1000, 1000)];
      expect(kinds([card({ recentPayments: payments })])).toContain("card-minimum-only");
    });
  });

  describe("payment due soon", () => {
    it("fires for a due day inside the window", () => {
      expect(kinds([card({ dueDay: 25 })])).toContain("card-payment-due-soon");
    });

    it("stays quiet for one comfortably beyond it", () => {
      expect(kinds([card({ dueDay: 18 })])).not.toContain("card-payment-due-soon");
    });

    it("stays quiet with no due day recorded", () => {
      expect(kinds([card({ dueDay: null })])).not.toContain("card-payment-due-soon");
    });

    it("rolls into next month when this month's day has passed", () => {
      const [finding] = detectCardAnomalies([card({ dueDay: 1, today: "2026-09-28" })]);
      expect(finding.kind).toBe("card-payment-due-soon");
      expect(finding.stateKey).toBe("card:due-soon:card_1:2026-10-01");
    });

    /** A 31st due day is the 30th in November, not the 1st of December. */
    it("clamps a late due day into a shorter month", () => {
      const [finding] = detectCardAnomalies([card({ dueDay: 31, today: "2026-11-25" })]);
      expect(finding.stateKey).toBe("card:due-soon:card_1:2026-11-30");
    });

    /**
     * Keyed on the occurrence, so dismissing this month's reminder does not silence next month's.
     */
    it("keys each month's reminder separately", () => {
      const september = detectCardAnomalies([card({ dueDay: 25, today: "2026-09-21" })])[0].stateKey;
      const october = detectCardAnomalies([card({ dueDay: 25, today: "2026-10-21" })])[0].stateKey;
      expect(october).not.toBe(september);
    });
  });

  it("reports several cards independently", () => {
    const findings = detectCardAnomalies([
      card({ id: "a", name: "A", utilization: 80 }),
      card({ id: "b", name: "B", utilization: 5, apr: 36, interestEverLogged: false }),
    ]);
    expect(findings.filter((f) => f.drillDown?.cardId === "a").map((f) => f.kind)).toEqual(["card-utilization-high"]);
    expect(findings.filter((f) => f.drillDown?.cardId === "b").map((f) => f.kind)).toEqual(["card-interest-untracked"]);
  });
});
