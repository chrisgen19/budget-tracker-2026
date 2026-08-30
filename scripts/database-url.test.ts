// @vitest-environment node
//
// These modules run under `tsx` in Node, never in a browser. The suite's default jsdom environment
// would exercise them under a DOM global scope they never see in production, and charge ~1s of
// environment setup for a few milliseconds of assertions.
import { describe, it, expect } from "vitest";
import { parseEnvValue } from "./database-url";

const URL_ = "postgres://user:pass@localhost:5432/db";

/**
 * Every expectation here was checked against the real thing: the `.env` was fed to
 * `prisma migrate status` and the datasource it printed is what these assert. This parser exists
 * only to agree with Prisma, so a rule invented here rather than observed is worse than no test.
 */
describe("parseEnvValue", () => {
  it("reads a bare value", () => {
    expect(parseEnvValue(`DATABASE_URL=${URL_}`, "DATABASE_URL")).toBe(URL_);
  });

  it("strips surrounding double and single quotes", () => {
    expect(parseEnvValue(`DATABASE_URL="${URL_}"`, "DATABASE_URL")).toBe(URL_);
    expect(parseEnvValue(`DATABASE_URL='${URL_}'`, "DATABASE_URL")).toBe(URL_);
  });

  it("accepts `export` and surrounding whitespace", () => {
    expect(parseEnvValue(`  export DATABASE_URL = "${URL_}"  `, "DATABASE_URL")).toBe(URL_);
  });

  // The dangerous divergence. dotenv assigns in a loop, so a later line overwrites an earlier one;
  // returning the first match would let a `.env` holding dev above prod clear the guard on
  // localhost while Prisma migrated production -- the incident this whole PR exists to prevent.
  // Verified: `prisma migrate status` on this file reports the second database.
  it("takes the LAST assignment, as dotenv does", () => {
    const contents = [
      'DATABASE_URL="postgres://u:p@localhost:5432/first-one"',
      'DATABASE_URL="postgres://u:p@second-host.example:5432/second-one"',
    ].join("\n");
    expect(parseEnvValue(contents, "DATABASE_URL")).toBe(
      "postgres://u:p@second-host.example:5432/second-one"
    );
  });

  // The closing quote has to be handled before the comment. Doing it the other way leaves the
  // quotes attached, and the guard then refuses a valid connection string as "not a URL".
  it("drops a comment after a quoted value, quotes and all", () => {
    expect(parseEnvValue(`DATABASE_URL="${URL_}" # local`, "DATABASE_URL")).toBe(URL_);
  });

  // Greedy matching reaches for the last quote on the line, which this comment supplies.
  it("does not let a comment containing quotes swallow the value", () => {
    expect(parseEnvValue(`DATABASE_URL="${URL_}" # note about "quotes"`, "DATABASE_URL")).toBe(URL_);
  });

  it("keeps a # inside a quoted value", () => {
    const withHash = "postgres://user:pa#ss@localhost:5432/db";
    expect(parseEnvValue(`DATABASE_URL="${withHash}"`, "DATABASE_URL")).toBe(withHash);
  });

  // An unquoted value has no closing mark, so dotenv matches it as [^#\r\n]+ and stops at the
  // first #, whitespace or not. Verified: `DATABASE_URL=postgres://u:p@localhost:5432/dbname#tail`
  // makes Prisma report database "dbname".
  it("ends an unquoted value at the first #, with or without whitespace", () => {
    expect(parseEnvValue(`DATABASE_URL=${URL_} # local`, "DATABASE_URL")).toBe(URL_);
    expect(parseEnvValue("DATABASE_URL=abc#def", "DATABASE_URL")).toBe("abc");
  });

  it("matches the whole key, not a prefix or suffix of one", () => {
    const contents = [
      "SHADOW_DATABASE_URL=shadow",
      "DATABASE_URL_EXTRA=extra",
      `DATABASE_URL=${URL_}`,
    ].join("\n");
    expect(parseEnvValue(contents, "DATABASE_URL")).toBe(URL_);
  });

  it("returns undefined for a key that is absent or commented out", () => {
    expect(parseEnvValue("OTHER=1", "DATABASE_URL")).toBeUndefined();
    expect(parseEnvValue(`# DATABASE_URL=${URL_}`, "DATABASE_URL")).toBeUndefined();
  });
});
