-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "bill_id" TEXT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "scheduled_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
