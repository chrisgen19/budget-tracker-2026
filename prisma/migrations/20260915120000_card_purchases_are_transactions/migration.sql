-- Card purchases become ordinary transactions, and card payments leave `transactions`.
--
-- 20260914120000 kept statement lines in `credit_charges` and counted only the payment as an
-- expense. That hid what a card was spent on from every category and label report. Now a purchase
-- is an EXPENSE transaction carrying credit_account_id, counted on the day it was bought, and a
-- payment is a `credit_payments` row that only lowers what the card owes.
--
-- ORDER MATTERS. Until this migration, credit_account_id on a transaction means "this pays the
-- card", so those rows are moved out before any charge is moved in under the new meaning. Every
-- statement below is a no-op on a database with no cards.

-- CreateEnum
CREATE TYPE "CreditPaymentKind" AS ENUM ('PAYMENT', 'CREDIT');

-- CreateTable
CREATE TABLE "credit_payments" (
    "id" TEXT NOT NULL,
    "kind" "CreditPaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_via" "TransactionSource" NOT NULL DEFAULT 'APP',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_payments_account_id_date_idx" ON "credit_payments"("account_id", "date");

-- CreateIndex
CREATE INDEX "credit_payments_user_id_date_idx" ON "credit_payments"("user_id", "date");

-- AddForeignKey
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 1. Payments move out of transactions. Their ids are kept, so a link to one still resolves to the
--    same record. Deleting the transaction removes its label links through their cascade.
INSERT INTO "credit_payments" ("id", "kind", "amount", "description", "date", "account_id", "user_id", "created_via", "created_at", "updated_at")
SELECT "id", 'PAYMENT', "amount", "description", "date", "credit_account_id", "user_id", "created_via", "created_at", "updated_at"
FROM "transactions"
WHERE "credit_account_id" IS NOT NULL;

DELETE FROM "transactions" WHERE "credit_account_id" IS NOT NULL;

-- 2. Refunds and reversals become card credits.
INSERT INTO "credit_payments" ("id", "kind", "amount", "description", "date", "account_id", "user_id", "created_via", "created_at", "updated_at")
SELECT "id", 'CREDIT', "amount", "description", "date", "account_id", "user_id", "created_via", "created_at", "updated_at"
FROM "credit_charges"
WHERE "kind" = 'CREDIT';

-- 3. Purchases, fees and interest become expenses paid with the card. A transaction has no column
--    for a foreign amount, so it is kept in the description rather than lost.
INSERT INTO "transactions" ("id", "amount", "description", "type", "date", "category_id", "user_id", "created_via", "credit_account_id", "created_at", "updated_at")
SELECT
  "id",
  "amount",
  CASE
    WHEN "original_currency" IS NOT NULL AND "original_amount" IS NOT NULL
      THEN TRIM("description" || ' (' || "original_currency" || ' ' || TO_CHAR("original_amount", 'FM999999990.00') || ')')
    ELSE "description"
  END,
  'EXPENSE',
  "date",
  "category_id",
  "user_id",
  "created_via",
  "account_id",
  "created_at",
  "updated_at"
FROM "credit_charges"
WHERE "kind" = 'CHARGE';

-- DropTable
DROP TABLE "credit_charges";

-- DropEnum
DROP TYPE "CreditChargeKind";

-- 4. The "Credit Card Payment" default existed only to file payments, and none are left in
--    transactions. Removed where nothing still references it, after clearing it from the
--    quick-pick arrays, which are plain String[] with no foreign key to clean them up.
UPDATE "users" u
SET "quick_expense_categories" = array_remove(u."quick_expense_categories", c."id")
FROM "categories" c
WHERE c."user_id" IS NULL
  AND c."is_default" = true
  AND c."name" = 'Credit Card Payment'
  AND c."type" = 'EXPENSE'
  AND c."id" = ANY(u."quick_expense_categories")
  AND NOT EXISTS (SELECT 1 FROM "transactions" t WHERE t."category_id" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "scheduled_transactions" s WHERE s."category_id" = c."id");

DELETE FROM "categories" c
WHERE c."user_id" IS NULL
  AND c."is_default" = true
  AND c."name" = 'Credit Card Payment'
  AND c."type" = 'EXPENSE'
  AND NOT EXISTS (SELECT 1 FROM "transactions" t WHERE t."category_id" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "scheduled_transactions" s WHERE s."category_id" = c."id");
