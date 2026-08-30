-- Accounts and transfers, part 1 of 2.
--
-- Split across two migrations on purpose. PostgreSQL permits `ALTER TYPE ... ADD VALUE` inside a
-- transaction block, but the new value cannot be *used* until that transaction commits, and
-- `prisma migrate deploy` runs each migration file in one transaction. The check constraint and
-- the Transfer category both reference the literal 'TRANSFER', so they live in part 2. Merging
-- these two files back together fails at deploy with `unsafe use of new value "TRANSFER"`.

ALTER TYPE "TransactionType" ADD VALUE 'TRANSFER';

CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK', 'CREDIT_CARD', 'EWALLET');

CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "opening_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit_limit" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT NOT NULL DEFAULT '#8B6FC0',
    "icon" TEXT NOT NULL DEFAULT 'Wallet',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounts_user_id_name_key" ON "accounts"("user_id", "name");
CREATE INDEX "accounts_user_id_is_active_idx" ON "accounts"("user_id", "is_active");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Both nullable: every transaction that predates accounts has no answer, and an unassigned row is
-- simply outside every account balance rather than wrongly attributed to one.
ALTER TABLE "transactions" ADD COLUMN "account_id" TEXT;
ALTER TABLE "transactions" ADD COLUMN "transfer_account_id" TEXT;

-- SetNull, not Cascade: detaching a row from a deleted account must never delete the transaction.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_account_id_fkey"
    FOREIGN KEY ("transfer_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "transactions_account_id_idx" ON "transactions"("account_id");
CREATE INDEX "transactions_transfer_account_id_idx" ON "transactions"("transfer_account_id");
