import { describe, expect, it, vi } from "vitest";
import { canUseCreditCards, readCreditCardsAccess, userCanUseCreditCards } from "./credit-card-access";
import type { PrismaClient } from "./budget-query-types";

const stub = ({ role, access }: { role: string | null; access: "ADMIN" | "EVERYONE" | null }) =>
  ({
    user: { findUnique: vi.fn(async () => (role ? { role } : null)) },
    siteSettings: { findUnique: vi.fn(async () => (access ? { creditCardsAccess: access } : null)) },
  }) as unknown as PrismaClient;

describe("canUseCreditCards", () => {
  it.each([
    ["ADMIN", "ADMIN", true],
    ["ADMIN", "EVERYONE", true],
    ["FREE", "ADMIN", false],
    ["PAID", "ADMIN", false],
    ["FREE", "EVERYONE", true],
    ["PAID", "EVERYONE", true],
  ] as const)("%s under %s: %s", (role, access, expected) => {
    expect(canUseCreditCards(role, access)).toBe(expected);
  });
});

describe("readCreditCardsAccess", () => {
  // A fresh database has no row, and must land on the safe setting without a seed.
  it("reads a missing row as admin only", async () => {
    expect(await readCreditCardsAccess(stub({ role: "FREE", access: null }))).toBe("ADMIN");
  });

  it("reads the stored switch", async () => {
    expect(await readCreditCardsAccess(stub({ role: "FREE", access: "EVERYONE" }))).toBe("EVERYONE");
  });
});

describe("userCanUseCreditCards", () => {
  it("refuses a regular user while the switch is admin only", async () => {
    expect(await userCanUseCreditCards(stub({ role: "FREE", access: null }), "u1")).toBe(false);
  });

  it("allows a regular user once switched to everyone", async () => {
    expect(await userCanUseCreditCards(stub({ role: "PAID", access: "EVERYONE" }), "u1")).toBe(true);
  });

  it("always allows an admin", async () => {
    expect(await userCanUseCreditCards(stub({ role: "ADMIN", access: "ADMIN" }), "u1")).toBe(true);
  });

  it("refuses a user that no longer exists", async () => {
    expect(await userCanUseCreditCards(stub({ role: null, access: "EVERYONE" }), "gone")).toBe(false);
  });
});
