import { describe, it, expect } from "vitest";
import { resolveWritePermission } from "./tokens";

const NOW = new Date("2026-08-25T10:00:00.000Z");
const IN_AN_HOUR = new Date("2026-08-25T11:00:00.000Z");
const AN_HOUR_AGO = new Date("2026-08-25T09:00:00.000Z");

describe("resolveWritePermission", () => {
  it("allows a write-scoped token while the lease is live", () => {
    expect(resolveWritePermission(["transactions:write"], IN_AN_HOUR, NOW)).toEqual({
      allowed: true,
    });
  });

  it("refuses a read-only token even with the lease live", () => {
    // The lease is a kill switch, not a grant: it can only ever subtract from what a token holds.
    expect(resolveWritePermission(["transactions:read"], IN_AN_HOUR, NOW)).toEqual({
      allowed: false,
      reason: "SCOPE_NOT_GRANTED",
    });
  });

  it("refuses a write-scoped token when writes have never been enabled", () => {
    expect(resolveWritePermission(["transactions:write"], null, NOW)).toEqual({
      allowed: false,
      reason: "WRITES_DISABLED",
    });
  });

  it("refuses a write-scoped token once the lease has lapsed", () => {
    // The point of a lease over a boolean: forgetting to switch it back off cannot leave writes
    // open for days, because the safe state is the one it returns to on its own.
    expect(resolveWritePermission(["transactions:write"], AN_HOUR_AGO, NOW)).toEqual({
      allowed: false,
      reason: "WRITES_DISABLED",
    });
  });

  it("treats the exact expiry instant as lapsed", () => {
    expect(resolveWritePermission(["transactions:write"], NOW, NOW)).toEqual({
      allowed: false,
      reason: "WRITES_DISABLED",
    });
  });

  it("refuses an empty grant", () => {
    expect(resolveWritePermission([], IN_AN_HOUR, NOW)).toEqual({
      allowed: false,
      reason: "SCOPE_NOT_GRANTED",
    });
  });

  it("reports the missing scope, not the lease, when both are absent", () => {
    // Order matters for the message the model sees: telling the user to flip a switch that would
    // not help wastes a round trip.
    expect(resolveWritePermission(["bills:read"], null, NOW)).toEqual({
      allowed: false,
      reason: "SCOPE_NOT_GRANTED",
    });
  });
});
