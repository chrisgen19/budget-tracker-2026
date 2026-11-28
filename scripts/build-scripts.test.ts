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

/**
 * The Node majors the `checks` job of the CI workflow runs.
 *
 * Read out of the `checks` job specifically: a first-match `node: [...]` over the whole file would
 * silently bind to a second matrix job added above it. Majors are returned, so a patch pin
 * (`"24.5.0"`) still satisfies a `node: [24]` leg.
 */
function ciNodeMajors(): string[] {
  const major = (version: string) => version.trim().replace(/^[^0-9]*/, "").split(".")[0];

  const workflow = readFileSync(join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");
  const jobStart = workflow.search(/^  checks:$/m);
  expect(jobStart).toBeGreaterThan(-1);
  const rest = workflow.slice(jobStart + 1);
  const jobEnd = rest.search(/^  \S/m);
  const checksJob = jobEnd === -1 ? rest : rest.slice(0, jobEnd);

  const matrix = checksJob.match(/^\s*node:\s*\[([^\]]*)\]/m);
  expect(matrix).not.toBeNull();
  const versions = matrix![1].split(",").map((v) => major(v.replace(/["']/g, "")));
  expect(versions.length).toBeGreaterThan(0);
  return versions;
}

/**
 * Splits `Dockerfile` into its stages. `name` is the lowercased `AS <name>`, `from` the image or
 * parent stage, and `lines` the stage's instruction lines with comments dropped, `\`
 * continuations joined into one line and the instruction keyword upper-cased (Docker accepts
 * `arg` and `Arg`, so a guard matching only `ARG` would be walked around by a lowercase one).
 *
 * Instructions above the first `FROM` (a global `ARG`, say) are kept as a leading stage named
 * `<preamble>` instead of being dropped, so a guard over every stage cannot miss them. `FROM`
 * flags such as `--platform=linux/amd64` are skipped when reading the image.
 */
function dockerStages(): { name: string; from: string; lines: string[] }[] {
  const raw = readFileSync(join(__dirname, "..", "Dockerfile"), "utf8");
  const joined = raw.replace(/\\[ \t]*\r?\n/g, " ");
  const stages: { name: string; from: string; lines: string[] }[] = [
    { name: "<preamble>", from: "", lines: [] },
  ];
  for (const line of joined.split(/\r?\n/).map((l) => l.trim())) {
    if (line === "" || line.startsWith("#")) continue;
    const from = line.match(/^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i);
    if (from) {
      stages.push({ name: (from[2] ?? "").toLowerCase(), from: from[1], lines: [] });
    } else {
      const normalised = line.replace(/\s+/g, " ").replace(/^\S+/, (k) => k.toUpperCase());
      stages[stages.length - 1].lines.push(normalised);
    }
  }
  return stages;
}

describe("build scripts", () => {
  it("keeps every database-touching command out of `pnpm build`", () => {
    for (const command of DATABASE_TOUCHING) {
      expect(scripts.build).not.toContain(command);
    }
  });

  // The whole point of the split: the migrating build has to exist, or the build packs call a
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

  /**
   * Railpack is the fallback build pack: production switched to it from Nixpacks on 2026-11-27,
   * `nixpacks.toml` was deleted once that deploy succeeded, and the Dockerfile now builds
   * production. Its Node provider runs the `build`
   * script by default, which deploys code without its migrations, and an array in `railpack.json`
   * keeps the provider's own commands wherever it contains `"..."`. So the build step has to call
   * `build:deploy` by name and must not spread the defaults back in.
   */
  it("is wired to railpack", () => {
    const raw = readFileSync(join(__dirname, "..", "railpack.json"), "utf8");
    const railpack = JSON.parse(raw);
    const commands: unknown = railpack.steps?.build?.commands;
    expect(Array.isArray(commands)).toBe(true);
    expect(commands).toContain("pnpm build:deploy");
    expect(commands).not.toContain("...");
    // Over the whole file, not just the build step: a `pnpm build` in another step or in the start
    // command reinstates the non-migrating path just as well.
    expect(raw).not.toMatch(/pnpm build(?!:deploy)/);
  });

  /**
   * The apt arrays are the opposite case from the build commands: an array without `"..."` REPLACES
   * the packages Railpack generates rather than adding to them. Coolify's Railpack wrapper also
   * appends `curl` and `wget` to the runtime list, and both Coolify Scheduled Tasks (bill reminders,
   * the Telegram evening prompt) run `curl` inside the container, so a replaced list breaks them
   * with `curl: command not found` and nothing in the deploy fails. Railpack does not document
   * whether this file or Coolify's `RAILPACK_DEPLOY_APT_PACKAGES` wins, so the list names `curl`
   * and `wget` itself as well as spreading the defaults.
   */
  it("extends railpack's apt packages rather than replacing them", () => {
    const railpack = JSON.parse(readFileSync(join(__dirname, "..", "railpack.json"), "utf8"));
    expect(railpack.buildAptPackages).toContain("...");
    expect(railpack.buildAptPackages).toContain("openssl");
    for (const pkg of ["...", "openssl", "curl", "wget"]) {
      expect(railpack.deploy?.aptPackages).toContain(pkg);
    }
  });

  /**
   * The Railpack Node pin has to be a version CI actually runs. The two numbers live in different
   * files with nothing tying them together, and the gap is silent in the direction that matters: a
   * green pipeline on one version while the image ships another, so a behaviour change in a
   * dependency path -- deprecations, OpenSSL defaults, undici -- surfaces only in production.
   *
   * The matrix is read out of the workflow rather than hardcoded, so adding a version to CI is
   * enough and this test never has to be the second place to edit. It is read out of the `checks`
   * job specifically: a first-match `node: [...]` over the whole file would silently bind to a
   * second matrix job added above it, and pass while the leg that actually runs lint, type-check,
   * build and test covered something else.
   *
   * Majors are compared, so a legitimate patch pin (`"24.5.0"`) still satisfies a `node: [24]` leg.
   */
  it("pins railpack to a Node version the CI matrix covers", () => {
    const major = (version: string) => version.trim().replace(/^[^0-9]*/, "").split(".")[0];
    const railpack = JSON.parse(readFileSync(join(__dirname, "..", "railpack.json"), "utf8"));
    expect(ciNodeMajors()).toContain(major(String(railpack.packages?.node)));
  });

  /**
   * The Dockerfile is the second way to build production, so the properties Railpack needed are
   * pinned for it too, each for its own reason.
   *
   * `build:deploy` by name: a plain `pnpm build` deploys code without its migrations, the gap
   * behind #192, and the Dockerfile has no provider default to fall back on, only what it says.
   * The Node base must be a major CI runs, for the same silent-gap reason as the Railpack pin.
   *
   * `DATABASE_URL` is the only ARG, and only in the build stage: Coolify always passes
   * `--build-arg KEY` for every build-time variable, secrets included, and any ARG the Dockerfile
   * declares with a matching name receives the real value, which every later `RUN` in that stage
   * records in the image history. The "Inject Build Args to Dockerfile" setting only decides
   * whether Coolify inserts an ARG for each variable after every `FROM`, so it stays off. An ARG
   * above the first `FROM` is global and counts too.
   *
   * The deps stage copies only the lockfile, `.npmrc` and the Prisma schema before installing so
   * the layer is cached until dependencies change; `COPY . .` there would rebuild it on every
   * commit, and every deploy would then write a fresh multi-GB layer (4 GB per deploy on this host).
   *
   * The runtime image needs `curl` and `wget` because both Coolify Scheduled Tasks (bill
   * reminders, the Telegram evening prompt) run `curl` inside the container, and `openssl` for
   * Prisma's engine; slim images ship none of them, and nothing in the deploy fails when missing.
   */
  it("builds the Docker image with build:deploy", () => {
    const raw = readFileSync(join(__dirname, "..", "Dockerfile"), "utf8");
    expect(raw).toMatch(/^RUN pnpm build:deploy$/m);
    expect(raw).not.toMatch(/pnpm build(?!:deploy)/);
  });

  it("bases every Dockerfile stage on a Node major the CI matrix covers", () => {
    const images = dockerStages().map((s) => s.from).filter((f) => f.startsWith("node:"));
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image).toMatch(/^node:\d+-bookworm-slim$/);
      expect(ciNodeMajors()).toContain(image.slice(5).split("-")[0]);
    }
  });

  it("declares DATABASE_URL only in the stage that runs build:deploy, and no other ARG", () => {
    const withArgs = dockerStages().filter((s) => s.lines.some((l) => l.startsWith("ARG ")));
    expect(withArgs.map((s) => s.name)).toEqual(["build"]);
    const build = withArgs[0];
    expect(build.lines.filter((l) => l.startsWith("ARG "))).toEqual(["ARG DATABASE_URL"]);
    expect(build.lines).toContain("RUN pnpm build:deploy");
  });

  /**
   * Next's standalone step copies `.env` and `.env.production` from the app directory into
   * `.next/standalone`, and the runtime stage copies that directory whole, so an env file that
   * reaches the build context ends up at `/app/.env` in the image that ships. Coolify also writes
   * the app's runtime variables to `.env` in the build directory, which is the build context, and
   * a local `docker build` would send the developer's own. Inside the build the Prisma CLI reads
   * `.env` too, so a missing `--build-arg DATABASE_URL` would silently fall back to it.
   *
   * `.dockerignore` mirrors `.gitignore`: `.env` and `.env.*` out, `.env.example` back in.
   */
  it("keeps .env files out of the Docker build context", () => {
    const rules = readFileSync(join(__dirname, "..", ".dockerignore"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    expect(rules).toContain(".env");
    expect(rules).toContain(".env.*");
    expect(rules.indexOf("!.env.example")).toBeGreaterThan(rules.indexOf(".env.*"));
  });

  it("installs dependencies from the lockfile, .npmrc and schema only", () => {
    const deps = dockerStages().find((s) => s.name === "deps")!;
    const install = deps.lines.findIndex((l) => l.includes("pnpm install --frozen-lockfile"));
    expect(install).toBeGreaterThan(-1);
    const copied = deps.lines.slice(0, install).filter((l) => l.startsWith("COPY ")).join(" ");
    for (const file of ["package.json", "pnpm-lock.yaml", ".npmrc", "prisma/schema.prisma"]) {
      expect(copied).toContain(file);
    }
    expect(copied).not.toMatch(/COPY \. /);
  });

  it("gives the runtime image openssl, curl and wget, and starts the standalone server", () => {
    const stages = dockerStages();
    const runtime = stages.find((s) => s.name === "runtime")!;
    const chain = [stages.find((s) => s.name === runtime.from)!, runtime];
    const apt = chain.flatMap((s) => s.lines).filter((l) => l.includes("apt-get install")).join(" ");
    for (const pkg of ["openssl", "ca-certificates", "curl", "wget"]) {
      expect(apt).toMatch(new RegExp(`\\b${pkg}\\b`));
    }
    const body = runtime.lines.join("\n");
    expect(body).toMatch(/COPY --from=build .*\/app\/\.next\/standalone \.\//);
    expect(body).toMatch(/COPY --from=build .*\/app\/\.next\/static \.\/\.next\/static/);
    expect(body).toMatch(/COPY --from=build .*\/app\/public \.\/public/);
    expect(body).toMatch(/PORT=3000/);
    expect(body).toMatch(/HOSTNAME=0\.0\.0\.0/);
    expect(body).toContain('CMD ["node", "server.js"]');
    expect(body).toMatch(/^USER nextjs$/m);
  });
});
