import { describe, it, expect } from "vitest";
import { describeWindow } from "./period-label";

describe("describeWindow", () => {
  it("names a month", () => {
    expect(describeWindow({ month: "2026-08", from: "2026-08-01", to: "2026-08-31" })).toBe(
      " in 2026-08"
    );
  });

  it("names both ends of a range, so a week does not read as a month", () => {
    expect(describeWindow({ month: null, from: "2026-08-24", to: "2026-08-29" })).toBe(
      " from 2026-08-24 to 2026-08-29"
    );
  });

  it("collapses a single day", () => {
    expect(describeWindow({ month: null, from: "2026-08-29", to: "2026-08-29" })).toBe(
      " on 2026-08-29"
    );
  });

  it("says which end is open", () => {
    expect(describeWindow({ month: null, from: "2026-08-24", to: null })).toBe(" since 2026-08-24");
    expect(describeWindow({ month: null, from: null, to: "2026-08-24" })).toBe(" up to 2026-08-24");
  });

  it("says nothing when nothing was filtered on", () => {
    expect(describeWindow(null)).toBe("");
    expect(describeWindow({ month: null, from: null, to: null })).toBe("");
  });
});
