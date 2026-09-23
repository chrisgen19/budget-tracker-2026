/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { majorVersion, versionSkew } from "./pg-version";

/** Real output from both commands, so the parser is pinned to what Postgres actually prints. */
const SERVER_17 = "17.9 (Ubuntu 17.9-1.pgdg24.04+1)";
const SERVER_18 = "18.3 (Ubuntu 18.3-1.pgdg24.04+1)";
const DUMP_17 = "pg_dump (PostgreSQL) 17.9 (Ubuntu 17.9-1.pgdg24.04+1)\n";
const DUMP_18 = "pg_dump (PostgreSQL) 18.3 (Ubuntu 18.3-1.pgdg24.04+1)\n";

describe("majorVersion", () => {
  it("reads the major version out of both commands' prose", () => {
    expect(majorVersion(SERVER_17)).toBe(17);
    expect(majorVersion(DUMP_17)).toBe(17);
    expect(majorVersion("18.3")).toBe(18);
  });

  it("is null when there is no version to read", () => {
    expect(majorVersion("")).toBeNull();
    expect(majorVersion("unreachable")).toBeNull();
  });
});

describe("versionSkew", () => {
  it("refuses a server newer than pg_dump, naming both versions and the package", () => {
    const problem = versionSkew(SERVER_18, DUMP_17);
    expect(problem).toContain("server is PostgreSQL 18");
    expect(problem).toContain("local pg_dump is 17");
    expect(problem).toContain("postgresql-client-18");
  });

  it("allows an equal or newer pg_dump", () => {
    // The direction that matters: flipping the comparison makes this case fail, not only the one
    // above, so a reversed guard cannot pass this file.
    expect(versionSkew(SERVER_17, DUMP_18)).toBeNull();
    expect(versionSkew(SERVER_17, DUMP_17)).toBeNull();
  });

  it("allows the backup through when either version is unreadable", () => {
    expect(versionSkew("unreachable", DUMP_17)).toBeNull();
    expect(versionSkew(SERVER_18, "")).toBeNull();
  });
});
