-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "bill_id" TEXT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "scheduled_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: set bill_id from existing paid scheduled_transaction_logs
UPDATE "transactions" t
SET "bill_id" = stl."scheduled_transaction_id"
FROM "scheduled_transaction_logs" stl
WHERE stl."transaction_id" = t."id"
  AND stl."status" = 'PAID'
  AND t."bill_id" IS NULL;
