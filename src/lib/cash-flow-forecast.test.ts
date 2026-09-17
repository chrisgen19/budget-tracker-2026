import { describe, expect, it } from "vitest";
import { buildCashFlowForecast, scheduledForecastEvents } from "@/lib/cash-flow-forecast";

describe("buildCashFlowForecast", () => {
  it("carries daily balances and names the first cash crunch", () => {
    const result = buildCashFlowForecast({
      openingBalance: 100,
      from: "2026-09-01",
      to: "2026-09-03",
      events: [
        { date: "2026-09-02", amount: 150, kind: "bill", description: "Rent", estimated: false, assumption: "scheduled" },
        { date: "2026-09-03", amount: 80, kind: "scheduled-income", description: "Pay", estimated: false, assumption: "scheduled" },
      ],
    });
    expect(result.days.map((item) => item.projectedBalance)).toEqual([100, -50, 30]);
    expect(result.lowestBalance).toEqual({ date: "2026-09-02", balance: -50 });
    expect(result.cashCrunches).toEqual([{ date: "2026-09-02", balance: -50 }]);
  });
});

describe("scheduledForecastEvents", () => {
  it("uses an explicitly labeled estimate for a variable bill", () => {
    const events = scheduledForecastEvents([{
      id: "utility", amount: 500, description: "Power", type: "EXPENSE", frequency: "MONTHLY", customIntervalDays: null,
      startDate: new Date("2025-01-05T00:00:00Z"), endDate: null, nextDueDate: new Date("2026-09-05T00:00:00Z"), isVariable: true,
      payments: [{ id: "payment", amount: 700, date: new Date("2025-09-06T00:00:00Z") }],
      occurrences: [{ dueDate: new Date("2025-09-05T00:00:00Z"), transactionId: "payment" }],
    }], "2026-09-01", "2026-09-30", -480);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ date: "2026-09-05", amount: 700, estimated: true });
    expect(events[0].assumption).toContain("Variable bill estimate");
  });

  it("omits a paid occurrence even when its transaction was recorded on another day", () => {
    const events = scheduledForecastEvents([{
      id: "salary", amount: 1000, description: "Salary", type: "INCOME", frequency: "MONTHLY", customIntervalDays: null,
      startDate: new Date("2026-01-01T00:00:00Z"), endDate: null, nextDueDate: new Date("2026-10-01T00:00:00Z"), isVariable: false,
      payments: [{ id: "payment", amount: 1000, date: new Date("2026-09-17T00:00:00Z") }],
      occurrences: [{ dueDate: new Date("2026-10-01T00:00:00Z"), transactionId: "payment" }],
    }], "2026-09-17", "2026-10-16", -480);
    expect(events).toEqual([]);
  });

  it("reaches the forecast window for a daily schedule more than 500 days overdue", () => {
    const events = scheduledForecastEvents([{
      id: "daily", amount: 10, description: "Daily", type: "EXPENSE", frequency: "DAILY", customIntervalDays: null,
      startDate: new Date("2024-01-01T00:00:00Z"), endDate: null, nextDueDate: new Date("2024-01-01T00:00:00Z"), isVariable: false,
      payments: [], occurrences: [],
    }], "2026-09-01", "2026-09-03", -480);
    expect(events.filter((event) => !event.description.startsWith("Overdue:")).map((event) => event.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("puts outstanding overdue bill occurrences on the first forecast day", () => {
    const events = scheduledForecastEvents([{
      id: "rent", amount: 100, description: "Rent", type: "EXPENSE", frequency: "MONTHLY", customIntervalDays: null,
      startDate: new Date("2026-01-01T00:00:00Z"), endDate: null, nextDueDate: new Date("2026-07-01T00:00:00Z"), isVariable: false,
      payments: [], occurrences: [],
    }], "2026-09-01", "2026-09-03", -480);
    expect(events).toMatchObject([
      { date: "2026-09-01", description: "Overdue: Rent" },
      { date: "2026-09-01", description: "Rent" },
    ]);
  });
});
