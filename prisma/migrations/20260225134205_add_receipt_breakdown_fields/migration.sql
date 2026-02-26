-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "receipt_breakdown" JSONB,
ADD COLUMN     "receipt_group_id" TEXT;

-- CreateIndex
CREATE INDEX "transactions_receipt_group_id_idx" ON "transactions"("receipt_group_id");
