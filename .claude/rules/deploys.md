---
paths:
  - prisma/schema.prisma
  - "prisma/migrations/**"
  - scripts/check-migration-drift.ts
  - Dockerfile
  - railpack.json
  - src/app/sw.ts
---

# Deploys are not atomic

A deploy is minutes long, and during those minutes three things disagree with each other. None of
them errors on its own, so each rule below exists because a reviewer caught it once (#304, #306)
rather than because anything failed.

## A migration must leave the running release working

`build:deploy` is `prisma generate && prisma migrate deploy && check-migration-drift && next build`.
The migration runs **before** the build, and the previous container keeps serving for the whole of
`next build`. So every migration is applied while the old code is still answering requests against
it, and if the build then fails, that old code stays up against the new schema with no cutover to
repair it.

The order is deliberate and stays: `build:deploy` is the one script allowed to touch the production
database (#192), and moving the migration into a start-command wrapper would run it once per
container. The fix is a discipline, not a pipeline change: **expand/contract**.

- **Expand (safe in one PR with the code):** new table, new nullable column, new column with a
  default, new index, widening a type.
- **Contract (its own PR, after the code that stops using it has deployed):** `DROP TABLE`,
  `DROP COLUMN`, a rename, `SET NOT NULL`, narrowing a type, a new unique constraint on existing
  data.

A rename is both at once, so it is two deploys: add the new name and write both, then drop the old.

The worked example is #304 then #307. #304 reverted the label/category code and **left**
`label_categories` in place. #307 dropped the table once #304 was live. Its migration header
(`20260913140000_drop_label_categories`) says why: dropping it alongside the revert would have
removed a table the still-serving release selected on every label query.

Keep the model in `schema.prisma` until the contract PR, and stop *reading* it in code instead.
Remove the model in the same PR as the drop. Remove it early and every migration name still
matches while the schema and the database disagree, so the next `prisma migrate dev` on an
unrelated change silently generates the `DROP`. That is why #304 kept the model and #307 removed it
alongside the drop migration. `check-migration-drift.ts` diffs the two (`prisma migrate diff
--from-schema-datasource`) and fails the deploy on any difference, so that shape no longer ships.

Write the contract migration as a **forward** migration. Never edit or delete an applied one: the
drift check fails any deploy whose checkout lacks a migration the database has applied.

## The Dockerfile takes no build ARG but DATABASE_URL

Production builds from `Dockerfile` (Coolify Build Pack: Dockerfile). `build:deploy` runs inside
the build stage, so that stage declares `ARG DATABASE_URL` for the migration and the drift check,
and **no other ARG** may be added. Coolify passes every build-time variable to `docker build` as
`--build-arg KEY` whether or not the Dockerfile declares it, which is harmless: an undeclared one
is dropped. What the "Inject Build Args to Dockerfile" toggle controls is whether Coolify inserts
an `ARG` line after every `FROM`. With it **on**, each later `RUN` in a stage records every
build-time value in the image history, secrets included. So the toggle stays **off** for this app,
and `DATABASE_URL` reaches the build as a plain build-time variable that is not baked into the
runtime image. `scripts/build-scripts.test.ts` pins the single ARG; it cannot see the Coolify
toggle, so that one is a setting to check by hand after any Coolify change.

## A `railpack.json` apt list replaces, it does not add

This section applies only to the fallback build pack: production builds from the Dockerfile, and
`railpack.json` stays so that switching Build Pack back to Railpack still works.

`steps.*.commands` and `aptPackages` read the same but behave in opposite directions. In both,
`"..."` stands for what Railpack generated. In the **commands** it must be absent: spreading the
Node provider's defaults back in reinstates plain `pnpm build`, the non-migrating path (#192). In
the **apt lists** it must be present, because an array without it replaces Railpack's runtime
packages rather than extending them.

The runtime list also names `curl` and `wget` itself. Coolify's Railpack wrapper appends those two
to `RAILPACK_DEPLOY_APT_PACKAGES`, and both Coolify Scheduled Tasks - bill reminders and the
Telegram evening prompt - shell out to `curl` inside the running container. Railpack does not
document whether this file or that environment variable wins when both set the list, so the file
names every package it needs rather than relying on the answer. The failure is silent either way:
the deploy succeeds and the crons stop, with `curl: command not found` in a task log nothing
watches. `scripts/build-scripts.test.ts` pins both halves.

## An API response shape change needs one release of backward compatibility

`src/app/sw.ts` precaches the JS bundles. `skipWaiting` and `clientsClaim` swap the *worker*, not
the script an open tab is already running, and `/api/*` is `NetworkOnly`. So after a deploy, new
JSON reaches old code through React Query's refetch-on-reconnect, refetch-on-mount once `staleTime`
lapses, and the invalidations after every mutation, and nothing reloads the page. (Not focus:
`query-client.ts` sets `refetchOnWindowFocus: false` app-wide.) `next.config.ts` sets no
`deploymentId`, and even with one, Next's skew protection covers RSC and server-action
requests, not the plain `fetch` calls this app's hooks make.

`UpdatePromptBanner` now offers the reload. `sw.ts` sets `skipWaiting: false` so a new worker
waits instead of swapping silently, `useServiceWorkerUpdate` finds it (already waiting, arriving via
`updatefound`, or found by the `update()` poll a long-open tab needs), and the page reloads on
`controllerchange` once the user accepts.

That shortens the window; it does not remove it. The prompt is a prompt, so a tab can sit on the old
bundle for as long as someone ignores it, and it is suppressed while offline. Every rule below still
applies:

- **Removing or renaming a response field:** keep returning it (empty or defaulted) for one
  release, then remove it in a later PR. #304 did this with the labels' `categories` array.
- **Changing a field's type or meaning:** add a new field instead.
- **Adding a field:** safe. Old code ignores it.
- **Tightening request validation:** an old bundle still sends the old body, so the server must
  accept it for one release, or the refusal has to read as a refusal in the old UI.
