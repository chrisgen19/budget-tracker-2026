---
paths:
  - prisma/schema.prisma
  - "prisma/migrations/**"
  - scripts/check-migration-drift.ts
  - nixpacks.toml
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
Remove the model in the same PR as the drop. #304 removed the model early, so every migration name
still matched while the schema and the database disagreed, and the next `prisma migrate dev` on an
unrelated change would have silently generated the `DROP`. `check-migration-drift.ts` now diffs the
two (`prisma migrate diff --from-schema-datasource`) and fails the deploy on any difference, so
that shape no longer ships.

Write the contract migration as a **forward** migration. Never edit or delete an applied one: the
drift check fails any deploy whose checkout lacks a migration the database has applied.

## An API response shape change needs one release of backward compatibility

`src/app/sw.ts` precaches the JS bundles. `skipWaiting` and `clientsClaim` swap the *worker*, not
the script an open tab is already running, and `/api/*` is `NetworkOnly`. So after a deploy, React
Query's refetch-on-focus feeds new JSON to old code, and nothing reloads the page. `next.config.ts`
sets no `deploymentId`, and even with one, Next's skew protection covers RSC and server-action
requests, not the plain `fetch` calls this app's hooks make.

Until there is an update-available prompt, the rule is by hand:

- **Removing or renaming a response field:** keep returning it (empty or defaulted) for one
  release, then remove it in a later PR. #304 did this with the labels' `categories` array.
- **Changing a field's type or meaning:** add a new field instead.
- **Adding a field:** safe. Old code ignores it.
- **Tightening request validation:** an old bundle still sends the old body, so the server must
  accept it for one release, or the refusal has to read as a refusal in the old UI.
