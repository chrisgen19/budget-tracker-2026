-- Accounts and transfers, part 2 of 2: everything that has to *use* the 'TRANSFER' enum value
-- added in part 1. See that file for why this cannot be one migration.

-- The invariant every account balance depends on, enforced in the database rather than only in
-- `createTransactionBatch`, because a hand-written UPDATE or a future write path that forgets the
-- rule would otherwise produce a transfer with no destination — money that leaves one account and
-- arrives nowhere, silently unbalancing the ledger.
--
-- Also forbids a transfer to the account it came from, which nets to zero but shows up twice in
-- the row list and reads as a real movement.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_shape_check" CHECK (
    (("type" = 'TRANSFER') = ("transfer_account_id" IS NOT NULL))
    AND ("transfer_account_id" IS NULL OR "transfer_account_id" <> "account_id")
);

-- The one system category a TRANSFER may use.
--
-- Inserted by the migration rather than added to `prisma/seed.ts`, because the seed is
-- deliberately not part of `pnpm build` (see AGENTS.md): seeding it would ship the transfer
-- feature to production while the only category it is allowed to use did not yet exist, and every
-- transfer would fail its category check. `isDefault: true` with a null user_id makes it shared,
-- and `DELETE /api/categories/[id]` filters on `is_default = false`, so it cannot be removed
-- through the app.
--
-- ON CONFLICT DO NOTHING covers the partial unique index on (name, type) WHERE user_id IS NULL
-- from migration 20260828100000: a re-run, or a database where the seed already created it, is
-- the state this wants rather than an error.
INSERT INTO "categories" ("id", "name", "type", "icon", "color", "is_default", "user_id", "created_at")
VALUES ('cat_system_transfer', 'Transfer', 'TRANSFER', 'ArrowLeftRight', '#8B7E6A', true, NULL, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
