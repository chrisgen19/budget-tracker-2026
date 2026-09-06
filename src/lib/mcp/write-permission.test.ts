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

  // --- The two write scopes are separate powers ---
  //
  // These are the tests that fail if anyone collapses the gate back into a single "may this token
  // write?" question. That is the whole reason `required` exists and has no default: creating a
  // row and rewriting one are different authorities, and the Telegram bot holds only the first.

  it("refuses to edit with a create-only token", () => {
    expect(
      resolveWritePermission(["transactions:write"], IN_AN_HOUR, "transactions:edit", NOW)
    ).toEqual({ allowed: false, reason: "SCOPE_NOT_GRANTED" });
  });

  it("refuses to create with an edit-only token", () => {
    expect(
      resolveWritePermission(["transactions:edit"], IN_AN_HOUR, "transactions:write", NOW)
    ).toEqual({ allowed: false, reason: "SCOPE_NOT_GRANTED" });
  });

  it("allows an edit-scoped token to edit while the lease is live", () => {
    expect(
      resolveWritePermission(["transactions:edit"], IN_AN_HOUR, "transactions:edit", NOW)
    ).toEqual({ allowed: true });
  });

  it("still gates an edit-scoped token behind the lease", () => {
    // The kill switch covers every write, not only creates: an edit rewrites data that exists,
    // which is the case it least wants to leave open.
    expect(resolveWritePermission(["transactions:edit"], null, "transactions:edit", NOW)).toEqual({
      allowed: false,
      reason: "WRITES_DISABLED",
    });
  });

  it("allows both when a token carries both scopes", () => {
    const scopes = ["transactions:write", "transactions:edit"] as const;
    expect(resolveWritePermission(scopes, IN_AN_HOUR, "transactions:write", NOW)).toEqual({
      allowed: true,
    });
    expect(resolveWritePermission(scopes, IN_AN_HOUR, "transactions:edit", NOW)).toEqual({
      allowed: true,
    });
  });
});
