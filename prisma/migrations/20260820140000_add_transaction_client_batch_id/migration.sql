-- AlterTable
-- Idempotency key for batch creation. Nullable: every existing row predates the mechanism,
-- and single-transaction creates never set it.
ALTER TABLE "transactions" ADD COLUMN "client_batch_id" TEXT;

-- CreateIndex
CREATE INDEX "transactions_user_id_client_batch_id_idx" ON "transactions"("user_id", "client_batch_id");
