// @vitest-environment node
/**
 * Pins which build script may migrate the production database.
 *
 * `prisma migrate deploy` used to live in `pnpm build`. That is the script every CI provider runs
 * by convention, and a Vercel project connected to this repo held a production `DATABASE_URL` and
 * built every branch push -- so seven migrations reached production between 28 and 71 seconds
 * after their *branch* commit, before review and before merge (issue #192).
 *
 * The property that fixes it is a name, and a name is exactly the kind of thing a later refactor
 * tidies away without noticing what it was for. So it is asserted here rather than left to a
 * comment.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const scripts: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8")
).scripts;

/** Commands that write schema to whatever `DATABASE_URL` is in scope. */
const SCHEMA_WRITING = ["migrate deploy", "migrate dev", "db push"];

describe("build scripts", () => {
  it("keeps every schema-writing command out of `pnpm build`", () => {
    for (const command of SCHEMA_WRITING) {
      expect(scripts.build).not.toContain(command);
    }
  });

  // The whole point of the split: the migrating build has to exist, or `nixpacks.toml` calls a
  // script that is not there and Coolify ships code ahead of its schema.
  it("migrates only in `build:deploy`", () => {
    expect(scripts["build:deploy"]).toContain("prisma migrate deploy");
  });

  // Drift is detected by comparing the database to `prisma/migrations`, so it can only run once
  // the deploy that carries a revert has been allowed to apply it.
  it("runs the drift check after the migration, never before", () => {
    const deploy = scripts["build:deploy"];
    expect(deploy.indexOf("prisma migrate deploy")).toBeLessThan(
      deploy.indexOf("check-migration-drift")
    );
  });

  // `build:deploy` is `build` plus migrations. Asserted so the two cannot drift: a change to how
  // the app is built that reaches only `build` would leave production building something else.
  it("builds the app the same way `pnpm build` does", () => {
    for (const step of scripts.build.split("&&").map((s) => s.trim())) {
      expect(scripts["build:deploy"]).toContain(step);
    }
    expect(scripts["build:deploy"].endsWith("next build")).toBe(true);
  });

  // nixpacks is the only builder that should reach the production database, and it reaches it by
  // calling the migrating script by name. Comment lines are stripped first: this file explains the
  // history in prose that names `pnpm build`, and matching that would assert the opposite of what
  // it says.
  it("is wired to nixpacks", () => {
    const nixpacks = readFileSync(join(__dirname, "..", "nixpacks.toml"), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(nixpacks).toContain("pnpm build:deploy");
    expect(nixpacks).not.toMatch(/pnpm build(?!:deploy)/);
  });
});
