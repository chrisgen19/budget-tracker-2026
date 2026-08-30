-- Revert 20260830100000_add_accounts_and_transfers and 20260830100001_transfer_constraint_and_category.
--
-- Those two migrations came from PR #187 (accounts and transfers), which was closed and never
-- merged. They reached the production database anyway, applied from a dev machine ~30 seconds
-- after the commit that generated them, so the schema gained a feature the deployed code has no
-- knowledge of.
--
-- The outage that followed: 20260830100001 inserted a category row with type 'TRANSFER', and the
-- deployed Prisma client's TransactionType has only INCOME and EXPENSE. Prisma validates enum
-- values when it *deserialises a result*, not only when it builds a query, so every
-- `category.findMany()` without a `type` filter threw "Value 'TRANSFER' not found in enum
-- 'TransactionType'" -- GET /api/categories, the MCP get_category_list tool, and therefore every
-- single Telegram bot message. Filtered reads (type=EXPENSE, type=INCOME) never saw the row and
-- kept working, which is why the app was only half broken.
--
-- Nothing depended on any of it: 0 transfer transactions, 0 transfer bills, 0 accounts, and no
-- transaction, bill or quick-category preference referencing the Transfer category.
--
-- EVERY STATEMENT HERE IS CONDITIONAL, and that is not defensive habit. This file also runs on
-- databases built from zero -- CI, a new environment, the scratch databases scripts/verify-*.ts
-- create -- where none of these objects were ever created. An unguarded DROP would make it
-- impossible to stand up a new environment ever again.

-- 1. The check constraint goes first. It contains the literal 'TRANSFER' and references
--    transfer_account_id, so it blocks both the enum rewrite below and the column drop after it.
--    Prisma cannot express CHECK constraints, so `prisma migrate diff` does not know this exists
--    and omits it from the revert it generates -- running that output alone fails here.
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_transfer_shape_check";

-- 2. The one row that actually broke production. It has to precede the enum rewrite, or the USING
--    cast in step 3 hits a value the new type does not accept and the whole migration fails.
--
--    Compared as ::text on purpose: on a database that never received 20260830100000, 'TRANSFER'
--    is not a valid TransactionType literal and the comparison itself would error before matching
--    zero rows.
DELETE FROM "categories" WHERE "type"::text = 'TRANSFER';

-- 3. Rebuild TransactionType without TRANSFER.
--
--    PostgreSQL has no ALTER TYPE ... DROP VALUE, so the type is recreated and every column
--    sharing it is re-pointed. Those columns are categories.type, scheduled_transactions.type and
--    transactions.type -- all three NOT NULL with no default, so no DROP DEFAULT is needed.
--
--    Guarded on the value being present, and issued through EXECUTE so that on a fresh database
--    plpgsql never parses a reference to a type that does not exist there.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'TransactionType' AND e.enumlabel = 'TRANSFER'
  ) THEN
    EXECUTE 'CREATE TYPE "TransactionType_new" AS ENUM (''INCOME'', ''EXPENSE'')';
    EXECUTE 'ALTER TABLE "categories" ALTER COLUMN "type" TYPE "TransactionType_new" USING ("type"::text::"TransactionType_new")';
    EXECUTE 'ALTER TABLE "scheduled_transactions" ALTER COLUMN "type" TYPE "TransactionType_new" USING ("type"::text::"TransactionType_new")';
    EXECUTE 'ALTER TABLE "transactions" ALTER COLUMN "type" TYPE "TransactionType_new" USING ("type"::text::"TransactionType_new")';
    EXECUTE 'ALTER TYPE "TransactionType" RENAME TO "TransactionType_old"';
    EXECUTE 'ALTER TYPE "TransactionType_new" RENAME TO "TransactionType"';
    EXECUTE 'DROP TYPE "TransactionType_old"';
  END IF;
END $$;

-- 4. The accounts table and the two transaction columns. Dropping a column takes its foreign key
--    and its index with it, so transactions_account_id_fkey, transactions_transfer_account_id_fkey,
--    transactions_account_id_idx and transactions_transfer_account_id_idx need no separate drops.
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "account_id";
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "transfer_account_id";

DROP TABLE IF EXISTS "accounts";
DROP TYPE IF EXISTS "AccountType";

-- 5. Finally the two history rows, so _prisma_migrations matches this repository again.
--
--    Without this they stay forever: `prisma migrate deploy` ignores applied migrations it cannot
--    find locally (it reported "No pending migrations to apply" across four deploys while this
--    drift was live), and `prisma migrate dev` treats them as drift and offers to reset the
--    database. Safe inside this migration's own transaction -- the migrate engine reads the applied
--    list before applying a migration and records this one's row afterwards.
--
--    Guarded on the table existing, which is not spare caution: Prisma replays every migration into
--    a *shadow database* for `migrate dev` and `migrate diff --to-migrations`, and it does not
--    create _prisma_migrations there. Unguarded, this fails with P1014 ("The underlying table for
--    model `_prisma_migrations` does not exist") and takes every future `pnpm db:migrate` with it.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'DELETE FROM "_prisma_migrations" WHERE "migration_name" IN (''20260830100000_add_accounts_and_transfers'', ''20260830100001_transfer_constraint_and_category'')';
  END IF;
END $$;
