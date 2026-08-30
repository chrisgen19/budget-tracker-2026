// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isMissingTableError } from "./prisma-errors";

/**
 * The shapes below were taken from a real Prisma 6.19.2 client against PostgreSQL, not from the
 * docs: a raw query on a table that does not exist, and a query against a port nothing listens on.
 */
describe("isMissingTableError", () => {
  it("accepts a Postgres undefined_table surfaced through a raw query", () => {
    expect(
      isMissingTableError({
        name: "PrismaClientKnownRequestError",
        code: "P2010",
        meta: { code: "42P01", message: 'relation "_prisma_migrations" does not exist' },
      })
    ).toBe(true);
  });

  // The whole reason this predicate exists. An unreachable host carries no code at all, and a bare
  // catch would report it as an empty database -- letting the drift check pass while blind.
  it("rejects an unreachable database", () => {
    expect(isMissingTableError({ name: "PrismaClientInitializationError" })).toBe(false);
  });

  // P2010 is "Raw query failed" for every cause, so the Prisma code alone settles nothing.
  it("rejects other raw-query failures that share the P2010 code", () => {
    expect(
      isMissingTableError({ code: "P2010", meta: { code: "42501", message: "permission denied" } })
    ).toBe(false);
    expect(
      isMissingTableError({ code: "P2010", meta: { code: "28P01", message: "auth failed" } })
    ).toBe(false);
  });

  it("rejects a non-P2010 Prisma error even with a matching driver code", () => {
    expect(isMissingTableError({ code: "P1001", meta: { code: "42P01" } })).toBe(false);
  });

  it("rejects values that are not error objects", () => {
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
    expect(isMissingTableError("relation does not exist")).toBe(false);
    expect(isMissingTableError(new Error("boom"))).toBe(false);
    expect(isMissingTableError({ code: "P2010" })).toBe(false);
    expect(isMissingTableError({ code: "P2010", meta: null })).toBe(false);
  });
});
