import { describe, it, expect } from "vitest";
import { resolveWritePermission } from "./tokens";

const NOW = new Date("2026-08-25T10:00:00.000Z");
const IN_AN_HOUR = new Date("2026-08-25T11:00:00.000Z");
const AN_HOUR_AGO = new Date("2026-08-25T09:00:00.000Z");

describe("resolveWritePermission", () => {
  it("allows a write-scoped token while the lease is live", () => {
    expect(
      resolveWritePermission(["transactions:write"], IN_AN_HOUR, "transactions:write", NOW)
    ).toEqual({ allowed: true });
  });

  it("refuses a read-only token even with the lease live", () => {
    // The lease is a kill switch, not a grant: it can only ever subtract from what a token holds.
    expect(
      resolveWritePermission(["transactions:read"], IN_AN_HOUR, "transactions:write", NOW)
    ).toEqual({ allowed: false, reason: "SCOPE_NOT_GRANTED" });
  });

  it("refuses a write-scoped token when writes have never been enabled", () => {
    expect(resolveWritePermission(["transactions:write"], null, "transactions:write", NOW)).toEqual(
      { allowed: false, reason: "WRITES_DISABLED" }
    );
  });

  it("refuses a write-scoped token once the lease has lapsed", () => {
    // The point of a lease over a boolean: forgetting to switch it back off cannot leave writes
    // open for days, because the safe state is the one it returns to on its own.
    expect(
      resolveWritePermission(["transactions:write"], AN_HOUR_AGO, "transactions:write", NOW)
    ).toEqual({ allowed: false, reason: "WRITES_DISABLED" });
  });

  it("treats the exact expiry instant as lapsed", () => {
    expect(resolveWritePermission(["transactions:write"], NOW, "transactions:write", NOW)).toEqual({
      allowed: false,
      reason: "WRITES_DISABLED",
    });
  });

  it("refuses an empty grant", () => {
    expect(resolveWritePermission([], IN_AN_HOUR, "transactions:write", NOW)).toEqual({
      allowed: false,
      reason: "SCOPE_NOT_GRANTED",
    });
  });

  it("reports the missing scope, not the lease, when both are absent", () => {
    // Order matters for the message the model sees: telling the user to flip a switch that would
    // not help wastes a round trip.
    expect(resolveWritePermission(["bills:read"], null, "transactions:write", NOW)).toEqual({
      allowed: false,
      reason: "SCOPE_NOT_GRANTED",
    });
  });

  // --- One scope covers both writes ---
  //
  // Editing shares `transactions:write` with creating, so a token already minted for logging keeps
  // working without being re-minted. `required` is still named at every call site: it costs a
  // literal and makes splitting editing out later a one-line change rather than an audit.

  it("allows editing with the same scope that allows creating", () => {
    expect(
      resolveWritePermission(["transactions:write"], IN_AN_HOUR, "transactions:write", NOW)
    ).toEqual({ allowed: true });
  });

  it("refuses a read-only token whichever write is attempted", () => {
    expect(
      resolveWritePermission(
        ["transactions:read", "budget:read"],
        IN_AN_HOUR,
        "transactions:write",
        NOW
      )
    ).toEqual({ allowed: false, reason: "SCOPE_NOT_GRANTED" });
  });

  it("gates editing behind the lease as well", () => {
    // The kill switch covers changing data as much as adding it -- more so, since an edit
    // rewrites what is already recorded.
    expect(resolveWritePermission(["transactions:write"], null, "transactions:write", NOW)).toEqual(
      { allowed: false, reason: "WRITES_DISABLED" }
    );
  });
});
