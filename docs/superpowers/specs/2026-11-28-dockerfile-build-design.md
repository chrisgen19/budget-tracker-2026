# Build production from a Dockerfile instead of Railpack

Status: approved 2026-11-28

## Intent

Production switched from Nixpacks to Railpack on 2026-11-27 (#422, #425). On 2026-11-28 the VPS
disk hit 84% and Coolify sent its 80% alert. Railpack costs about **4 GB per deploy**: a 1.51 GB
image (it ships the full `node_modules`, 836 MB, plus mise and Node, about 420 MB) and about
2.5 GB of BuildKit cache in its own `coolify-railpack` builder (`node_modules` is reinstalled on
nearly every build). Nixpacks cost about 2 GB per deploy. With 12 or 13 deploys a day, the disk fills
up between Coolify's cleanups.

A multi-stage Dockerfile that ships only the `output: "standalone"` bundle should bring the image
down to a few hundred MB. It also builds on Docker's default builder, which the existing
`docker builder prune -af` in Coolify's cleanup already handles. Production behaviour must not
change.

## Goals

- `Dockerfile` at the repo root (Coolify already has `dockerfile_location = /Dockerfile`).
- The runtime image holds only `.next/standalone`, `.next/static` and `public`. Target: under 500 MB.
- The dependency install layer is reused when `package.json`, `pnpm-lock.yaml`, `.npmrc` and
  `prisma/schema.prisma` have not changed.
- No secret value in the final image's metadata (`docker history`, `docker inspect`), matching the
  Railpack image today.

## Non-goals

- Changing how or when migrations run. `pnpm build:deploy` stays the build command, and migrations
  stay in the build (`.claude/rules/deploys.md`, #192).
- Changing the Node version (stays 24), the CI matrix, or `engines.node`.
- Deleting `railpack.json`. That is a follow-up PR once a Dockerfile deploy is green, the same as
  `nixpacks.toml` in #425 then #428.
- Trimming which Coolify variables are marked build-time. Not needed for this design (see
  "Secrets"), and it can be done later in the dashboard.

## Anti-goals (a failure even if the deploy is green)

- A deploy that skips migrations: any path that runs plain `pnpm build` (the #192 trap).
- Scheduled tasks failing silently with `curl: command not found`.
- Secrets (`DATABASE_URL`, `NEXTAUTH_SECRET`, `TELEGRAM_BOT_TOKEN`...) baked into image history.
- Prisma choosing the wrong query engine, which only shows up at the first query.

## Constraints (checked on the server and in the repo, 2026-11-28)

- **Base image: `node:24-bookworm-slim`** (Debian, glibc). Chosen in the design discussion. glibc matches the
  Railpack image running now, so Prisma's engine (`debian-openssl-3.0.x`) and `sharp` behave as they
  do today. `node:24-alpine` was rejected: smaller, but `sharp` and the Telegram bot would run on
  musl for the first time.
- **Packages:** `openssl` in both the build and runtime stages (Prisma). `curl` and `wget` in the
  runtime image: both Coolify Scheduled Tasks (`Bill Reminders`, `Telegram Evening Prompt`) run
  `curl ... http://localhost:3000/...` inside the container. `ca-certificates` so outbound HTTPS
  works (Gemini, R2, Resend, Telegram).
- **pnpm** at the `packageManager` pin (10.32.1) through corepack. `.npmrc` must be in the install
  layer: it holds `minimum-release-age`, `block-exotic-subdeps` and the `only-built-dependencies`
  allowlist, and without it Prisma and sharp install scripts don't run.
- `postinstall` runs `prisma generate`, so `prisma/schema.prisma` has to be copied before
  `pnpm install --frozen-lockfile`.
- **Runtime:** `node server.js` from the standalone root, `HOSTNAME=0.0.0.0`, `PORT=3000`,
  `NODE_ENV=production`. Coolify's health check is `/api/health` on port 3000.
- **Coolify Dockerfile builds** (`ApplicationDeploymentJob.php`, Coolify 4.7.9): build-time
  variables go in as `--build-arg`. With `inject_build_args_to_dockerfile = true` (the current
  setting), Coolify also writes an `ARG` for each of the 18 build-time variables after **every**
  `FROM`. Every later `RUN` in that stage then records all of their values in the layer history, and
  the runtime stage is a stage too.
- `.dockerignore` already excludes `.git`, `node_modules`, `.next` and `.env*.local`. The running
  Railpack container has no `.git` either, so `git rev-parse` in `next.config.ts` behaves the same
  as it does today.

## Secrets: declare one ARG, turn Coolify's injection off

- In Coolify, set **Inject Build Args to Dockerfile** off for this app
  (`inject_build_args_to_dockerfile = false`). Coolify still passes every build-time variable as
  `--build-arg`. Docker ignores the ones no stage declares and only warns.
- The Dockerfile declares `ARG DATABASE_URL` in the **build stage only**. That is the only build-time
  value the build needs: `prisma migrate deploy` and `check-migration-drift.ts` connect, and
  `next build` doesn't read the others. The repo has no `NEXT_PUBLIC_*` variables.
- The build stage's history holds the URL, but that stage isn't part of the final image. The deps
  and runtime stages declare no ARGs.
- Rejected alternative: Coolify's `use_build_secrets` (BuildKit `--secret` mounts, which is what
  Railpack does). It works, but Coolify rewrites the Dockerfile's `RUN` lines to mount them, so the
  Dockerfile in the repo is no longer what actually builds.

## Approaches considered

1. **Multi-stage standalone Dockerfile (chosen).** Image of a few hundred MB, default builder, cache
   keyed on the lockfile, and the build lives in the repo. Cost: one more file to maintain, and two
   Coolify settings to change.
2. **Keep Railpack and slim it down.** Change `railpack.json` so the deploy step copies only the
   standalone output, and clean up more often. Leaves the separate builder and its cache, and
   Railpack is Beta in Coolify. The run-every-6-hours cleanup (set 2026-11-28) already covers the
   short term.
3. **Back to Nixpacks.** About 2 GB per deploy and deprecated upstream. Rejected.

## Design

Four stages:

1. `base`: `node:24-bookworm-slim`, `apt-get install --no-install-recommends openssl
   ca-certificates`, `NEXT_TELEMETRY_DISABLED=1`, `WORKDIR /app`.
2. `deps` (from `base`): `corepack enable`, copy `package.json pnpm-lock.yaml .npmrc` and
   `prisma/schema.prisma`, `pnpm install --frozen-lockfile`.
3. `build` (from `deps`): `ARG DATABASE_URL`, `COPY . .`, `RUN pnpm build:deploy`.
4. `runtime` (from `base`): install `curl wget`, non-root `nextjs` user (uid 1001), copy
   `.next/standalone` to `./`, `.next/static` to `./.next/static`, `public` to `./public`, all
   `--chown=nextjs`. `ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000`, `EXPOSE 3000`,
   `CMD ["node", "server.js"]`. No `HEALTHCHECK` (Coolify's check overrides one anyway).

The two `cp -r` steps in `railpack.json` become the `COPY --from=build` lines.

### Guard tests (`scripts/build-scripts.test.ts`)

Move the Railpack assertions over to the Dockerfile and keep the Railpack ones while `railpack.json`
exists:

- The Dockerfile runs `pnpm build:deploy`, and no `pnpm build` without `:deploy` appears anywhere
  in it.
- Every `FROM node:<major>` is a major the CI `checks` matrix runs, reusing the existing matrix
  parser.
- The runtime stage installs `curl` and `openssl`.
- `ARG DATABASE_URL` appears only in the stage that runs `build:deploy`, and no other `ARG` names a
  secret.

### Docs

`AGENTS.md`, `.claude/rules/deploys.md`, `.claude/rules/testing.md` and `CHANGELOG.md` name the
Dockerfile as the production build, with Railpack as the fallback until the follow-up PR. Add
`Dockerfile` to the `paths:` of both rules files and to `STATIC_PATTERN` in
`.github/scripts/check-redesign-scope.sh`. Update the `ci.yml` comment that says 24 is what
`railpack.json` deploys.

## Rollout (manual, production, owner's call)

1. Merge. Nothing changes until the Build Pack is switched.
2. In Coolify for budget-tracker: Build Pack set to **Dockerfile**, **Inject Build Args to
   Dockerfile** off, port 3000 (unchanged), health check `/api/health` (unchanged).
3. Deploy. The log should show `prisma migrate deploy`, then `check-migration-drift`, then
   `next build`.
4. Checks after the deploy: health check green, image size (`docker images`), no secret in
   `docker history --no-trunc`, CSS, JS and icons load, a login works, and both scheduled tasks
   run with `curl` (trigger one by hand).
5. **Revert:** set Build Pack back to Railpack, turn injection back on, redeploy.
6. Follow-up PR: delete `railpack.json` and its tests.

## Verification before the PR

- `pnpm lint`, `pnpm type-check`, `pnpm test`.
- A local `docker build` on Colima, with `DATABASE_URL` pointing at a throwaway Postgres
  container so the migrations really run. Then run the image, check `/api/health`, run
  `curl --version` and `openssl version` inside it, check the size, and confirm `docker history`
  holds no build-arg values.

## Left to the builder

- Whether to add `mcp-server/`, `e2e/`, `docs/` and `design-mockups/` to `.dockerignore` to shrink
  the build context. Fine to do as long as `next build` and `tsc` don't need them.
- Whether to use a pnpm store cache mount (`RUN --mount=type=cache`). Optional, since the
  install layer is already cached by the lockfile.
- Whether Next's trace copies the Prisma engine into `.next/standalone`. If it doesn't, copy
  `node_modules/.prisma/client` across explicitly. Check this in the local run.
