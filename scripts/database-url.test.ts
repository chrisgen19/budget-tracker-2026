import { describe, it, expect } from "vitest";
import { parseEnvValue } from "./database-url";

const URL_ = "postgres://user:pass@localhost:5432/db";

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

  // Unquoted values have no closing mark, so only ` #` ends them -- a bare # is part of the value.
  it("ends an unquoted value at a whitespace-preceded comment only", () => {
    expect(parseEnvValue(`DATABASE_URL=${URL_} # local`, "DATABASE_URL")).toBe(URL_);
    expect(parseEnvValue("DATABASE_URL=abc#def", "DATABASE_URL")).toBe("abc#def");
  });

  it("matches the whole key, not a prefix or suffix of one", () => {
    const contents = ["SHADOW_DATABASE_URL=shadow", "DATABASE_URL_EXTRA=extra", `DATABASE_URL=${URL_}`].join("\n");
    expect(parseEnvValue(contents, "DATABASE_URL")).toBe(URL_);
  });

  it("returns undefined for a key that is absent or commented out", () => {
    expect(parseEnvValue("OTHER=1", "DATABASE_URL")).toBeUndefined();
    expect(parseEnvValue(`# DATABASE_URL=${URL_}`, "DATABASE_URL")).toBeUndefined();
  });
});
