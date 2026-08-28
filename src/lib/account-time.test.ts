import { describe, expect, it } from "vitest";
import {
  accountDateKey,
  accountMonthKey,
  formatAccountDateInput,
  relativeAccountDateInput,
} from "@/lib/account-time";

const INSTANT = new Date("2026-08-28T00:30:00.000Z");

describe("account time helpers", () => {
  it("formats an instant using the saved offset instead of the process timezone", () => {
    expect(formatAccountDateInput(INSTANT, -480)).toBe("2026-08-28T08:30");
    expect(formatAccountDateInput(INSTANT, 420)).toBe("2026-08-27T17:30");
  });

  it("derives account-local day and month keys across UTC boundaries", () => {
    const monthBoundary = new Date("2026-08-31T17:00:00.000Z");

    expect(accountDateKey(monthBoundary, -480)).toBe("2026-09-01");
    expect(accountMonthKey(monthBoundary, -480)).toBe("2026-09");
    expect(accountDateKey(monthBoundary, 420)).toBe("2026-08-31");
    expect(accountMonthKey(monthBoundary, 420)).toBe("2026-08");
  });

  it("moves relative days on the account calendar without using local Date accessors", () => {
    expect(relativeAccountDateInput(INSTANT, -480, -1)).toBe("2026-08-27T08:30");
    expect(relativeAccountDateInput(INSTANT, 420, 1)).toBe("2026-08-28T17:30");
  });
});
