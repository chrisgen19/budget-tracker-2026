# Dockerfile Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build production from a multi-stage `node:24-bookworm-slim` Dockerfile that ships only the Next.js standalone bundle, keeping `railpack.json` as the rollback.

**Architecture:** Four stages (`base` with openssl, `deps` with a lockfile-keyed install, `build` running `pnpm build:deploy` with the only `ARG DATABASE_URL`, and `runtime` with the standalone output plus curl and wget, non-root). Guard tests in `scripts/build-scripts.test.ts` pin the properties a later edit could silently break. A local build against a throwaway Postgres proves migrations, the Prisma engine, sharp, curl and clean image history before the PR.

**Tech Stack:** Docker (BuildKit), Node 24, pnpm 10.32.1 via corepack, Next.js 15 `output: "standalone"`, Prisma 6, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-28-dockerfile-build-design.md`

## Global Constraints

- Base image is `node:24-bookworm-slim` for every stage. Not alpine.
- The build command is `pnpm build:deploy`. No `pnpm build` (without `:deploy`) may appear anywhere in the Dockerfile, comments included.
- `openssl` in both the build and runtime images. `curl` and `wget` in the runtime image. Add `ca-certificates`.
- `ARG DATABASE_URL` only in the build stage. No other `ARG` anywhere in the Dockerfile.
- The runtime has `NODE_ENV=production`, `HOSTNAME=0.0.0.0`, `PORT=3000`, `EXPOSE 3000` and `CMD ["node", "server.js"]`, and runs as user `nextjs` (uid 1001).
- `railpack.json` and its tests stay unchanged. Deleting them is a follow-up PR.
- Don't add packages or change lint rules. Don't push and don't touch Coolify: the rollout is the owner's.
- Commits follow Conventional Commits. No em or en dashes in anything written.

## Review Focus

1. **Prisma engine missing from `.next/standalone`.** `/api/health` passes because it touches no database, but the first real query throws. Task 2 Step 5 runs a real query inside the container.
2. **`sharp` not traced into the standalone `node_modules`.** Receipt photo resizing (`src/lib/receipt-photo-image.ts`) would then fail only when someone attaches a photo. Task 2 Step 5 loads it.
3. **Secrets in image history.** A stray `ARG`, or Coolify's injection left on, records build-time values in `docker history`. Task 1 has a test for the first. Task 2 Step 6 checks a sentinel value. The rollout note covers the Coolify toggle.
4. **Non-root user can't write `.next/cache`.** `next/image` (`receipt-photo-strip.tsx`) writes its optimizer cache there at runtime. Task 2 Step 5 writes to it as `nextjs`.
5. **Install layer not cached.** If a source file reaches the `deps` stage, every deploy reinstalls `node_modules`, which is the disk problem this exists to fix. Task 1 tests the `deps` stage's inputs, and Task 2 Step 7 rebuilds after a source-only change and expects the install step `CACHED`.

---

### Task 1: Dockerfile and its guard tests

**Files:**
- Create: `Dockerfile`
- Modify: `.dockerignore` (add `mcp-server`, `e2e`, `docs`, `design-mockups`, only if `next build` doesn't need them, which Task 2 proves)
- Test: `scripts/build-scripts.test.ts` (new tests inside the existing `describe`, after "pins railpack to a Node version the CI matrix covers")

**Interfaces:**
- Produces: `ciNodeMajors(): string[]` (top-level helper in the test file, extracted from the existing railpack Node test, which is changed to use it. Same behavior: reads the `checks` job's `node: [...]`.)
- Produces: `dockerStages(): { name: string; from: string; lines: string[] }[]` (top-level helper in the test file). It splits `Dockerfile` on `FROM` lines, `name` comes from `AS <name>` (lowercased), `from` is the image or parent stage, and `lines` are the stage's non-comment instruction lines with `\` continuations joined.
- Produces: stage names `base`, `deps`, `build`, `runtime` (Task 2 builds with `--target runtime`).

- [ ] **Step 1: Write the failing tests**

```ts
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
```

Add a JSDoc block above the new group, like the existing ones, explaining why each exists: #192 for `build:deploy`, the Coolify ARG injection for the ARG rule, the 4 GB per deploy for the deps inputs, and the two Scheduled Tasks for curl.

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm vitest run scripts/build-scripts.test.ts`
Expected: the 5 new tests FAIL with `ENOENT ... Dockerfile`. The existing tests, including the refactored railpack Node test, PASS.

- [ ] **Step 3: Write `Dockerfile`**

Use the four stages from the spec's Design section. Pin these values:
- `base`: `apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*`, `ENV NEXT_TELEMETRY_DISABLED=1`, `WORKDIR /app`.
- `deps`: `RUN corepack enable`, `COPY package.json pnpm-lock.yaml .npmrc ./`, `COPY prisma/schema.prisma ./prisma/schema.prisma`, `RUN pnpm install --frozen-lockfile`.
- `build`: `ARG DATABASE_URL`, `COPY . .`, `RUN pnpm build:deploy`.
- `runtime`: `FROM base AS runtime`, install `curl wget` the same way, `groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -M nextjs`, the three `COPY --from=build --chown=nextjs:nodejs` lines, `mkdir -p .next/cache && chown nextjs:nodejs .next/cache` before `USER nextjs`, then the ENV, EXPOSE and CMD from Global Constraints.
- A header comment saying why: the disk cost, no ARG but `DATABASE_URL`, and that Coolify's "Inject Build Args to Dockerfile" must be off. Follow the budgettrackerdense Dockerfile's comment style.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm vitest run scripts/build-scripts.test.ts`
Expected: all PASS.

- [ ] **Step 5: Lint, type-check, full tests**

Run: `pnpm lint && pnpm type-check && pnpm test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore scripts/build-scripts.test.ts
git commit -m "build(deploy): add multi-stage standalone Dockerfile"
```

---

### Task 2: Local build and smoke test

This proves the image before anyone switches Coolify. The only commits are fixes this task finds, for example copying `node_modules/.prisma/client` across explicitly, or a `.dockerignore` entry `next build` turned out to need. Each fix goes back through Task 1's tests.

**Files:**
- Modify (only if a check fails): `Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: the `runtime` stage from Task 1.

- [ ] **Step 1: Start Docker and a throwaway Postgres**

Run: `colima start` then `docker run -d --name bt-build-pg -e POSTGRES_PASSWORD=build -e POSTGRES_DB=bt -p 55432:5432 postgres:16`
Expected: `docker ps` shows `bt-build-pg` up.

- [ ] **Step 2: Build with a sentinel in the URL**

Run: `docker build --network host --target runtime --build-arg 'DATABASE_URL=postgresql://postgres:build@127.0.0.1:55432/bt?application_name=SENTINEL_9f3a' --progress plain -t bt-docker-test .`
Expected: exit 0. The log shows `prisma migrate deploy` applying the migrations, then the drift check passing, then `next build`.

- [ ] **Step 3: Check the image size**

Run: `docker images bt-docker-test --format '{{.Size}}'`
Expected: under 500 MB (Railpack: 1.51 GB). Write the number down for the PR.

- [ ] **Step 4: Run it and check health**

Run: `docker run -d --name bt-docker-run --network host -e DATABASE_URL=postgresql://postgres:build@127.0.0.1:55432/bt -e NEXTAUTH_SECRET=local -e NEXTAUTH_URL=http://localhost:3000 -e TELEGRAM_BOT_ENABLED=false bt-docker-test` then `docker exec bt-docker-run curl -fsS http://localhost:3000/api/health`
Expected: `{"status":"ok"}`.

- [ ] **Step 5: Exercise what health doesn't**

Run each with `docker exec bt-docker-run`:
- `node -e "new (require('@prisma/client').PrismaClient)().\$queryRaw\`select 1\`.then(() => console.log('db ok'))"`: expect `db ok` (Review Focus 1).
- `node -e "require('sharp'); console.log('sharp ok')"`: expect `sharp ok` (Review Focus 2).
- `sh -c 'touch .next/cache/w && whoami'`: expect `nextjs` and no error (Review Focus 4).
- `curl --version`, `wget --version` and `openssl version`: all three print a version.

- [ ] **Step 6: Check no secret is in the image**

Run: `docker history --no-trunc bt-docker-test | grep -c SENTINEL_9f3a` and `docker inspect bt-docker-test | grep -c SENTINEL_9f3a`
Expected: `0` and `0` (Review Focus 3).

- [ ] **Step 7: Check the install layer is cached**

Touch a source file only (`echo >> src/app/api/health/route.ts`, then revert it after the build) and run the Step 2 build again.
Expected: the `pnpm install --frozen-lockfile` step shows `CACHED` (Review Focus 5).

- [ ] **Step 8: Clean up**

Run: `docker rm -f bt-docker-run bt-build-pg && docker rmi bt-docker-test`
Expected: all three removed. Commit any fixes from this task as `fix(deploy): <what>`.

---

### Task 3: Docs, scope check and changelog

**Files:**
- Modify: `.claude/rules/deploys.md` (`paths:` adds `Dockerfile`, plus a short section: no ARG but `DATABASE_URL`, and Coolify's ARG injection off. The `railpack.json` apt section stays, marked as applying only to the fallback.)
- Modify: `.claude/rules/testing.md` (`paths:` adds `Dockerfile`. The Node floor paragraph says production builds from the Dockerfile on Node 24, that Railpack is the fallback, and that `build-scripts.test.ts` checks both.)
- Modify: `AGENTS.md:101`, `:107` (add `Dockerfile` to the rule paths), `:112` and `:157` (the Dockerfile calls `build:deploy`, and `railpack.json` stays as the fallback)
- Modify: `.github/scripts/check-redesign-scope.sh:30` (`STATIC_PATTERN` ends `^(nixpacks\.toml|railpack\.json|Dockerfile|\.dockerignore)$`)
- Modify: `.github/workflows/ci.yml:32` (the comment says 24 is what the Dockerfile deploys)
- Modify: `CHANGELOG.md` (new top entry `## 2026-11-28 - Production builds from a Dockerfile`: why (about 4 GB per Railpack deploy, the 84% alert), image size from Task 2 Step 3, the Coolify settings to change, and revert by switching back to Railpack)
- Modify: `docs/superpowers/specs/2026-11-28-dockerfile-build-design.md` (Status: approved 2026-11-28)

- [ ] **Step 1: Make the edits above**

- [ ] **Step 2: Check the scope script counts the Dockerfile as backend**

Run: `printf 'Dockerfile\n.dockerignore\n' | grep -cE "$(sed -n "s/^STATIC_PATTERN='\(.*\)'$/\1/p" .github/scripts/check-redesign-scope.sh)"`
Expected: `2`.

- [ ] **Step 3: Check nothing still says Railpack is the only build pack**

Run: `grep -rn "only build pack\|Railpack is the only" --exclude-dir=node_modules --exclude-dir=.next --exclude=CHANGELOG.md .`
Expected: no matches, or only the railpack test's JSDoc, reworded to "the fallback build pack".

- [ ] **Step 4: Lint, type-check, full tests**

Run: `pnpm lint && pnpm type-check && pnpm test`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add .claude/rules/deploys.md .claude/rules/testing.md AGENTS.md .github/scripts/check-redesign-scope.sh .github/workflows/ci.yml CHANGELOG.md docs/superpowers/specs/2026-11-28-dockerfile-build-design.md scripts/build-scripts.test.ts
git commit -m "docs(deploy): document the Dockerfile build and Railpack fallback"
```

---

## Rollout (not part of execution, the owner does it after merge)

In Coolify for budget-tracker: set Build Pack to **Dockerfile**, turn **Inject Build Args to Dockerfile** off, then deploy. Then check that the health check is green, `docker history --no-trunc` on the new image has no `DATABASE_URL` value, and one Scheduled Task runs when triggered by hand. To revert: set Build Pack back to Railpack, turn injection back on, and redeploy.
