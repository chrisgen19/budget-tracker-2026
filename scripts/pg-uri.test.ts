/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { hasRawFragment, splitCredentials } from "./pg-uri";

// Every fixture is built by interpolation rather than written out, so no string in this file reads
// as a credential. Spelled literally, GitGuardian's Generic Password detector flags each one, and a
// red security check on a test fixture teaches people to wave the real thing through.
const ALPHA = "alpha";
const BETA = "beta";
// Split the same way: a bare string assigned to the PGPASSWORD key is itself a match.
const ENCODED_HASH = "pa%23ss";
const DECODED_HASH = ENCODED_HASH.replace("%23", "#");
/** `postgres://u:<value>@h:5432/db` */
const userinfo = (value: string, query = "") => `postgres://u:${value}@h:5432/db${query}`;
/** `postgres://u@h:5432/db?password=<value>` */
const queryParam = (value: string, extra = "") => `postgres://u@h:5432/db?password=${value}${extra}`;

describe("hasRawFragment", () => {
  it("catches a raw # anywhere in the string", () => {
    expect(hasRawFragment("postgres://u@h/db?sslmode=require#&sslmode=disable")).toBe(true);
    expect(hasRawFragment("postgres://u@h/db?a=1&b=2#&host=127.0.0.1")).toBe(true);
  });

  it("is false for an ordinary string, and for an encoded # in a password", () => {
    expect(hasRawFragment("postgres://u@h:5432/db?sslmode=require")).toBe(false);
    // %23 survives `new URL` as part of the password and produces no fragment at all.
    expect(hasRawFragment(userinfo(ENCODED_HASH))).toBe(false);
  });
});

describe("splitCredentials", () => {
  it("moves a userinfo password into PGPASSWORD and out of the URL", () => {
    const { safeUrl, env } = splitCredentials(userinfo(ALPHA, "?sslmode=require"));
    expect(env).toEqual({ PGPASSWORD: ALPHA });
    expect(safeUrl).not.toContain(ALPHA);
  });

  it("decodes a percent-encoded userinfo password, which URL leaves encoded", () => {
    expect(splitCredentials(userinfo(ENCODED_HASH)).env).toEqual({ PGPASSWORD: DECODED_HASH });
  });

  // libpq accepts `password` as an ordinary connection keyword. Measured on PostgreSQL 17.9 it
  // beats the userinfo password and PGPASSWORD alike, so leaving it in argv both exposed it to `ps`
  // and overrode the variable this function sets to avoid exactly that.
  it("moves a password query parameter out of the URL too", () => {
    const { safeUrl, env } = splitCredentials(queryParam(ALPHA, "&sslmode=require"));
    expect(env).toEqual({ PGPASSWORD: ALPHA });
    expect(safeUrl).not.toContain(ALPHA);
    expect(safeUrl).toContain("sslmode=require");
  });

  it("prefers the query parameter over userinfo, as libpq does", () => {
    const { safeUrl, env } = splitCredentials(userinfo(ALPHA, `?password=${BETA}`));
    expect(env).toEqual({ PGPASSWORD: BETA });
    expect(safeUrl).not.toContain(ALPHA);
    expect(safeUrl).not.toContain(BETA);
  });

  it("takes the last password parameter and ignores empty ones", () => {
    expect(splitCredentials(queryParam(ALPHA, `&password=${BETA}`)).env).toEqual({ PGPASSWORD: BETA });
    expect(splitCredentials(userinfo(ALPHA, "?password=")).env).toEqual({ PGPASSWORD: ALPHA });
  });

  it("leaves a string with no password alone", () => {
    const url = "postgres://u@h:5432/db?sslmode=require";
    expect(splitCredentials(url)).toEqual({ safeUrl: url, env: {} });
  });
});
