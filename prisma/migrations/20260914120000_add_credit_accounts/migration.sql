-- Credit cards, tracked as debts rather than as spending.
--
-- Charges go in their own table and never in "transactions", on purpose. Every expense total in the
-- app reads "transactions" alone, so keeping card charges out of it keeps them out of every total
-- with no filter for any query to forget. Paying the card is the expense: an ordinary transaction
-- carrying credit_account_id. Additive only: two new tables and one nullable column.

-- CreateEnum
CREATE TYPE "CreditChargeKind" AS ENUM ('CHARGE', 'CREDIT');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "credit_account_id" TEXT;

-- CreateTable
-- No balance column. What is owed is derived from the ledger on every read, so it cannot drift.
CREATE TABLE "credit_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#8B7E6A',
    "credit_limit" DOUBLE PRECISION,
    "statement_day" INTEGER,
    "due_day" INTEGER,
    "opening_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opening_balance_date" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "bill_id" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_charges" (
    "id" TEXT NOT NULL,
    "kind" "CreditChargeKind" NOT NULL DEFAULT 'CHARGE',
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "original_amount" DOUBLE PRECISION,
    "original_currency" TEXT,
    "account_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_via" "TransactionSource" NOT NULL DEFAULT 'APP',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transactions_credit_account_id_idx" ON "transactions"("credit_account_id");

-- CreateIndex
-- One card per reminder bill.
CREATE UNIQUE INDEX "credit_accounts_bill_id_key" ON "credit_accounts"("bill_id");

-- CreateIndex
CREATE INDEX "credit_accounts_user_id_is_active_idx" ON "credit_accounts"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "credit_charges_account_id_date_idx" ON "credit_charges"("account_id", "date");

-- CreateIndex
CREATE INDEX "credit_charges_user_id_date_idx" ON "credit_charges"("user_id", "date");

-- CreateIndex
CREATE INDEX "credit_charges_category_id_idx" ON "credit_charges"("category_id");

-- AddForeignKey
-- RESTRICT: a card with payments can only be archived, or those payments would claim to pay nothing.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_credit_account_id_fkey" FOREIGN KEY ("credit_account_id") REFERENCES "credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "scheduled_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_charges" ADD CONSTRAINT "credit_charges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
