import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecurringCard } from "@/components/analytics/assessment/trends-card";
import type { AssessmentRecurringFacts, AssessmentRecurringItem } from "@/types";

const fmt = (value: number | null) => (value === null ? "-" : `P${value}`);

const item = (over: Partial<AssessmentRecurringItem>): AssessmentRecurringItem => ({
  description: "Netflix",
  months: 6,
  occurrences: 6,
  established: true,
  avgAmount: 499,
  total: 2994,
  isNew: false,
  firstSeen: "2026-03-03",
  lastSeen: "2026-08-03",
  intervalDays: 30,
  expectedNextDate: "2026-09-02",
  daysOverdue: 0,
  latestAmount: 499,
  priorAvgAmount: 499,
  latestAmountSince: "2026-03-03",
  ...over,
});

const facts = (items: AssessmentRecurringItem[]): AssessmentRecurringFacts => ({
  items,
  newItems: [],
  monthlyBase: 915,
  monthlyBasePct: 12,
  income: [],
});

describe("RecurringCard", () => {
  /**
   * Codex, on #378. Once quarterly and yearly charges reached this list, the card still said every
   * charge "comes back month after month", and a yearly subscription seen twice read "2 months".
   */
  it("shows a yearly charge's cadence rather than the months it was seen in", () => {
    render(
      <RecurringCard
        recurring={facts([item({ description: "Adobe Creative Cloud", months: 2, occurrences: 2, avgAmount: 4990, intervalDays: 365 })])}
        fmt={fmt}
      />
    );
    expect(screen.getByText("P4990 · yearly")).toBeDefined();
    expect(screen.queryByText(/2 months/)).toBeNull();
  });

  it("still calls a monthly charge monthly", () => {
    render(<RecurringCard recurring={facts([item({})])} fmt={fmt} />);
    expect(screen.getByText("P499 · monthly")).toBeDefined();
  });

  it("no longer describes every recurring charge as monthly", () => {
    render(<RecurringCard recurring={facts([item({})])} fmt={fmt} />);
    expect(screen.queryByText(/month after month/)).toBeNull();
    expect(screen.queryByText(/come back every month/)).toBeNull();
  });
});
