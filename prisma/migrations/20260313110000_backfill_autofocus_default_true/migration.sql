-- Backfill existing rows to true (preserve previous always-on behavior)
UPDATE "users" SET "transaction_amount_autofocus" = true
WHERE "transaction_amount_autofocus" = false;

-- Change column default for new signups
ALTER TABLE "users"
ALTER COLUMN "transaction_amount_autofocus" SET DEFAULT true;
