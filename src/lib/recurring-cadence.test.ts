import { describe, expect, it } from "vitest";
import { cadenceLabel } from "@/lib/recurring-cadence";

describe("cadenceLabel", () => {
  it("names the cycles people recognise", () => {
    expect(cadenceLabel(7)).toBe("weekly");
    expect(cadenceLabel(14)).toBe("every 2 weeks");
    expect(cadenceLabel(30)).toBe("monthly");
    expect(cadenceLabel(61)).toBe("every 2 months");
    expect(cadenceLabel(91)).toBe("quarterly");
    expect(cadenceLabel(182)).toBe("every 6 months");
    expect(cadenceLabel(365)).toBe("yearly");
  });

  /** A measured cadence wobbles: a monthly charge billed on the 1st runs 28 to 31 days. */
  it("tolerates the drift of a real billing date", () => {
    expect(cadenceLabel(28)).toBe("monthly");
    expect(cadenceLabel(31)).toBe("monthly");
    expect(cadenceLabel(96)).toBe("quarterly");
    expect(cadenceLabel(380)).toBe("yearly");
  });

  it("gives the days when the gap is no familiar cycle", () => {
    expect(cadenceLabel(45)).toBe("every 45 days");
    expect(cadenceLabel(3)).toBe("every 3 days");
  });

  /** Found on real data: a daily fare read "every 1 days". */
  it("says daily rather than every 1 days", () => {
    expect(cadenceLabel(1)).toBe("daily");
  });

  it("is null with no measurable gap, so the caller keeps its old wording", () => {
    expect(cadenceLabel(null)).toBeNull();
  });
});
