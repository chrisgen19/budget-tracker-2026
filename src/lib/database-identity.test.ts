import { describe, expect, it } from "vitest";
import { describeDatabaseUrl } from "@/lib/database-identity";

describe("describeDatabaseUrl", () => {
  /**
   * The bug this covers: the merge script asked operators to confirm they were pointed at the
   * right database, while printing only cuids, which identify no environment. Running it from a
   * local checkout against production is a documented workflow, so "am I on prod?" has to be
   * answerable from the output.
   */
  it("names host, port and database", () => {
    expect(describeDatabaseUrl("postgres://postgres:secret@72.61.113.145:9856/budgettracker")).toBe(
      "72.61.113.145:9856/budgettracker"
    );
  });

  it("distinguishes local from production at a glance", () => {
    const local = describeDatabaseUrl("postgres://myuser:pw@localhost:5432/budgettracker-nextjs");
    const prod = describeDatabaseUrl("postgres://postgres:pw@72.61.113.145:9856/budgettracker-nextjs");

    expect(local).toBe("localhost:5432/budgettracker-nextjs");
    expect(prod).not.toBe(local);
  });

  it("never leaks the password or user", () => {
    const out = describeDatabaseUrl("postgres://admin:hunter2@db.example.com:5432/app?sslmode=require");

    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("admin");
    // Query strings can carry credentials too (sslcert, password=...).
    expect(out).not.toContain("?");
    expect(out).toBe("db.example.com:5432/app");
  });

  it("defaults the port when the URL omits it", () => {
    expect(describeDatabaseUrl("postgres://u:p@host/db")).toBe("host:5432/db");
  });

  it("says so when DATABASE_URL is unset, rather than printing nothing", () => {
    expect(describeDatabaseUrl(undefined)).toContain("not set");
    expect(describeDatabaseUrl("")).toContain("not set");
  });

  it("does not echo a malformed URL, which still contains the password", () => {
    const out = describeDatabaseUrl("postgres//admin:hunter2@host/db");

    expect(out).not.toContain("hunter2");
    expect(out).toBe("unparseable DATABASE_URL");
  });
});
