-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "bill_id" TEXT;

-- CreateIndex
CREATE INDEX "transactions_bill_id_idx" ON "transactions"("bill_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "scheduled_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: set bill_id from existing paid scheduled_transaction_logs
-- Only where the transaction owner matches the bill owner
UPDATE "transactions" t
SET "bill_id" = stl."scheduled_transaction_id"
FROM "scheduled_transaction_logs" stl
JOIN "scheduled_transactions" st ON st."id" = stl."scheduled_transaction_id"
WHERE stl."transaction_id" = t."id"
  AND stl."status" = 'PAID'
  AND st."user_id" = t."user_id"
  AND t."bill_id" IS NULL;
