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

/**
 * Anything that opens a connection to whatever `DATABASE_URL` is in scope -- not only the commands
 * that write.
 *
 * AGENTS.md states that `pnpm build` touches no database, and a test that pinned only the writing
 * half would let the documentation claim more than it guarantees. `migrate status` cannot cause
 * #192 (it reads), but a build step that dials production from an arbitrary CI provider is the
 * reachability half of that incident, which issue #194 covers separately. `check-migration-drift`
 * is on the list for the same reason: it constructs a PrismaClient, and it belongs to the deploy.
 */
const DATABASE_TOUCHING = [
  "migrate deploy",
  "migrate dev",
  "migrate status",
  "migrate resolve",
  "db push",
  "db execute",
  "db seed",
  "check-migration-drift",
];

describe("build scripts", () => {
  it("keeps every database-touching command out of `pnpm build`", () => {
    for (const command of DATABASE_TOUCHING) {
      expect(scripts.build).not.toContain(command);
    }
  });

  // The whole point of the split: the migrating build has to exist, or `nixpacks.toml` calls a
  // script that is not there and Coolify ships code ahead of its schema.
  it("migrates in `build:deploy`", () => {
    expect(scripts["build:deploy"]).toContain("prisma migrate deploy");
  });

  /**
   * ...and in nothing else. Checking `build` alone leaves the hole one rung up: npm and pnpm run
   * `prebuild` automatically before `build`, so a `"prebuild": "prisma migrate deploy"` added later
   * reinstates #192 in full -- every branch push migrating production -- while every assertion
   * above still passes. `postinstall` and `prepare` run by convention too.
   *
   * Named scripts are listed rather than lifecycle hooks specifically, because the property is
   * "one script migrates", and enumerating the hooks means reopening this the day a new one exists.
   */
  it("migrates in nothing else", () => {
    const migrating = Object.entries(scripts)
      .filter(([, command]) => command.includes("prisma migrate deploy"))
      .map(([name]) => name);
    expect(migrating).toEqual(["build:deploy"]);
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
