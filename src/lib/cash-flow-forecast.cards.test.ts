import { describe, expect, it } from "vitest";
import { buildCashFlowForecast, cardPaymentEvents, type ForecastCard } from "@/lib/cash-flow-forecast";

const card = (over: Partial<ForecastCard> = {}): ForecastCard => ({
  id: "card_1",
  name: "BPI Gold",
  balance: 48000,
  dueDay: 5,
  billId: null,
  plannedPayment: null,
  observedMonthly: null,
  minimumPct: 5,
  minimumFloor: 500,
  ...over,
});

const FROM = "2026-09-21";
const TO = "2026-12-20";

describe("cardPaymentEvents", () => {
  it("emits one payment per due day inside the horizon", () => {
    const events = cardPaymentEvents([card()], FROM, TO);
    expect(events.map((event) => event.date)).toEqual(["2026-10-05", "2026-11-05", "2026-12-05"]);
    expect(events.every((event) => event.kind === "card-payment")).toBe(true);
  });

  /**
   * The linked reminder bill emits its own `bill` event from the same schedule. Counting both takes
   * the payment out of the bank twice, and the lowest projected balance is the whole output.
   */
  it("skips a card whose payment is already a bill", () => {
    expect(cardPaymentEvents([card({ billId: "bill_1" })], FROM, TO)).toEqual([]);
  });

  /**
   * A guessed date answers the question wrongly rather than approximately: the forecast reports
   * *when* the balance bottoms out, not just that it does.
   */
  it("skips a card with no due day rather than guessing one", () => {
    expect(cardPaymentEvents([card({ dueDay: null })], FROM, TO)).toEqual([]);
  });

  it("skips a card that owes nothing", () => {
    expect(cardPaymentEvents([card({ balance: 0 })], FROM, TO)).toEqual([]);
    expect(cardPaymentEvents([card({ balance: -250 })], FROM, TO)).toEqual([]);
  });

  it("skips a card with no figure to pay at all", () => {
    const bare = card({ minimumPct: null, minimumFloor: null });
    expect(cardPaymentEvents([bare], FROM, TO)).toEqual([]);
  });

  describe("which figure it pays", () => {
    it("prefers the plan, and says so", () => {
      const [first] = cardPaymentEvents([card({ plannedPayment: 8000, observedMonthly: 5000 })], FROM, TO);
      expect(first.amount).toBe(8000);
      expect(first.assumption).toContain("planned");
    });

    it("falls back to what is actually being paid", () => {
      const [first] = cardPaymentEvents([card({ observedMonthly: 5000 })], FROM, TO);
      expect(first.amount).toBe(5000);
      expect(first.assumption).toContain("have been paying");
    });

    it("falls back to the bank's minimum last", () => {
      const [first] = cardPaymentEvents([card()], FROM, TO);
      expect(first.amount).toBe(2400); // 5% of 48,000, above the 500 floor
      expect(first.assumption).toContain("minimum");
    });
  });

  /**
   * Without walking the balance down, a 90-day horizon would take three 8,000 payments out of the
   * bank against a 5,000 debt, understating the projected balance by 19,000.
   */
  it("never pays out more than the card owes", () => {
    const events = cardPaymentEvents([card({ balance: 5000, plannedPayment: 8000 })], FROM, TO);
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe(5000);
  });

  it("stops once the balance is cleared part-way through", () => {
    const events = cardPaymentEvents([card({ balance: 10000, plannedPayment: 6000 })], FROM, TO);
    expect(events.map((event) => event.amount)).toEqual([6000, 4000]);
  });

  /** The 31st is the 30th in November and the 28th in February. */
  it("clamps a due day into a shorter month", () => {
    const events = cardPaymentEvents([card({ dueDay: 31, plannedPayment: 1000 })], "2026-10-01", "2026-12-01");
    expect(events.map((event) => event.date)).toEqual(["2026-10-31", "2026-11-30"]);
  });

  it("carries the card id so the row can be traced back", () => {
    const [first] = cardPaymentEvents([card({ plannedPayment: 1000 })], FROM, TO);
    expect(first.sourceId).toBe("card_1");
  });

  it("handles several cards at once", () => {
    const events = cardPaymentEvents(
      [card({ plannedPayment: 1000 }), card({ id: "card_2", name: "BDO", dueDay: 20, plannedPayment: 500 })],
      FROM,
      "2026-10-31"
    );
    expect(events.filter((event) => event.sourceId === "card_1")).toHaveLength(1);
    expect(events.filter((event) => event.sourceId === "card_2")).toHaveLength(1);
  });
});

describe("card spending leaves the bank exactly once", () => {
  /**
   * The bug this pins, which shipped in the first cut of this feature.
   *
   * A card purchase is an ordinary EXPENSE, so it already lowers the tracked balance on the day it
   * is made -- that is the identity cards.md states: cash = tracked + owed - card opening balances.
   * Emitting a payment for it as well takes the same money out twice. The route therefore excludes
   * card purchases from the balance it starts from, and the whole card balance is paid off here.
   *
   * 10,000 of cash, a 3,000 card balance, a 3,000 planned payment. The bank must end at 7,000. If
   * the purchase were also deducted from the opening balance it would end at 4,000.
   */
  it("ends at the cash that is left, not at cash minus the purchase twice", () => {
    const events = cardPaymentEvents(
      [card({ balance: 3000, plannedPayment: 3000, dueDay: 5 })],
      "2026-09-21",
      "2026-10-31"
    );
    const forecast = buildCashFlowForecast({
      // Cash with the card purchase excluded, which is what the route now computes.
      openingBalance: 10000,
      from: "2026-09-21",
      to: "2026-10-31",
      events,
    });

    expect(forecast.days.at(-1)?.projectedBalance).toBe(7000);
  });

  /** And the payment does land on the due day rather than being spread or deferred. */
  it("takes it out on the due day", () => {
    const events = cardPaymentEvents(
      [card({ balance: 3000, plannedPayment: 3000, dueDay: 5 })],
      "2026-09-21",
      "2026-10-31"
    );
    const forecast = buildCashFlowForecast({ openingBalance: 10000, from: "2026-09-21", to: "2026-10-31", events });
    const due = forecast.days.find((day) => day.date === "2026-10-05");

    expect(due?.outflows).toBe(3000);
    expect(due?.projectedBalance).toBe(7000);
    expect(forecast.days.find((day) => day.date === "2026-10-04")?.projectedBalance).toBe(10000);
  });
});
