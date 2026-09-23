/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { effectiveSslMode, sslProblem } from "./pg-sslmode";

const at = (query: string) => `postgres://u:p@db.example:5432/app?${query}`;

describe("effectiveSslMode", () => {
  it("reads a single value", () => {
    expect(effectiveSslMode(at("sslmode=require"))).toBe("require");
  });

  it("takes the last occurrence, as libpq does", () => {
    // Measured: sslmode=require&sslmode=disable connects with ssl = f. Reading the first value
    // here is the bug this module exists for, so both orders are pinned.
    expect(effectiveSslMode(at("sslmode=require&sslmode=disable"))).toBe("disable");
    expect(effectiveSslMode(at("sslmode=disable&sslmode=require"))).toBe("require");
  });

  it("skips empty values rather than returning them", () => {
    expect(effectiveSslMode(at("sslmode=&sslmode=disable"))).toBe("disable");
    expect(effectiveSslMode(at("sslmode=require&sslmode="))).toBe("require");
    expect(effectiveSslMode(at("sslmode="))).toBeNull();
  });

  it("is null when unset or unparseable", () => {
    expect(effectiveSslMode(at("application_name=x"))).toBeNull();
    expect(effectiveSslMode("not a url")).toBeNull();
  });
});

describe("sslProblem", () => {
  it("refuses every mode that permits cleartext", () => {
    for (const mode of ["disable", "allow", "prefer"]) {
      expect(sslProblem(at(`sslmode=${mode}`))).toContain(`sslmode=${mode}`);
    }
  });

  it("refuses a string with no sslmode at all", () => {
    expect(sslProblem(at("application_name=x"))).toContain("no sslmode=");
  });

  it("refuses a duplicate that ends in a cleartext mode", () => {
    // The bypass: the guard used to read `require` here and allow it.
    expect(sslProblem(at("sslmode=require&sslmode=disable"))).toContain("sslmode=disable");
  });

  it("allows require and above", () => {
    for (const mode of ["require", "verify-ca", "verify-full"]) {
      expect(sslProblem(at(`sslmode=${mode}`))).toBeNull();
    }
    expect(sslProblem(at("sslmode=disable&sslmode=verify-full"))).toBeNull();
  });
});
