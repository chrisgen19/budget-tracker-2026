import { describe, expect, it } from "vitest";
import { isTokenDead } from "@/lib/mcp/token-status";

const NOW = Date.parse("2026-08-26T12:00:00.000Z");

describe("isTokenDead", () => {
  it("is alive when it neither expires nor was revoked", () => {
    expect(isTokenDead({ revokedAt: null, expiresAt: null }, NOW)).toBe(false);
  });

  it("is alive while its expiry is still ahead", () => {
    expect(isTokenDead({ expiresAt: "2026-09-01T00:00:00.000Z" }, NOW)).toBe(false);
  });

  it("is dead once revoked", () => {
    expect(isTokenDead({ revokedAt: "2026-08-10T00:00:00.000Z" }, NOW)).toBe(true);
  });

  // The bug this covers: the list called an expired token dead and offered only Delete, while
  // the endpoint asked for `revoked_at` specifically and answered 409. An expired token could
  // then be neither revoked (no button) nor deleted, which is a dead end with no way out.
  it("is dead once expired, even if it was never revoked", () => {
    expect(isTokenDead({ revokedAt: null, expiresAt: "2026-08-25T00:00:00.000Z" }, NOW)).toBe(true);
  });

  it("treats the expiry instant itself as expired", () => {
    expect(isTokenDead({ expiresAt: "2026-08-26T12:00:00.000Z" }, NOW)).toBe(true);
  });

  it("accepts Date objects as well as ISO strings, since Prisma returns Dates", () => {
    expect(isTokenDead({ expiresAt: new Date("2026-08-25T00:00:00.000Z") }, NOW)).toBe(true);
    expect(isTokenDead({ revokedAt: new Date("2026-08-10T00:00:00.000Z") }, NOW)).toBe(true);
    expect(isTokenDead({ expiresAt: new Date("2026-09-01T00:00:00.000Z") }, NOW)).toBe(false);
  });

  it("treats an unparseable timestamp as absent rather than as dead", () => {
    // Erring towards alive: refusing to delete something is recoverable, and a parse failure is
    // not evidence that a credential stopped working.
    expect(isTokenDead({ expiresAt: "not-a-date" }, NOW)).toBe(false);
    expect(isTokenDead({ revokedAt: "nonsense" }, NOW)).toBe(false);
  });

  it("handles missing fields entirely", () => {
    expect(isTokenDead({}, NOW)).toBe(false);
  });
});
