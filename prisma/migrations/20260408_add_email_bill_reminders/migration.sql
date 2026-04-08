-- AlterTable
ALTER TABLE "users" ADD COLUMN "email_bill_reminders" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "bill_email_logs" (
    "id" TEXT NOT NULL,
    "scheduled_transaction_id" TEXT NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bill_email_logs_scheduled_transaction_id_due_date_key" ON "bill_email_logs"("scheduled_transaction_id", "due_date");

-- CreateIndex
CREATE INDEX "bill_email_logs_scheduled_transaction_id_idx" ON "bill_email_logs"("scheduled_transaction_id");

-- AddForeignKey
ALTER TABLE "bill_email_logs" ADD CONSTRAINT "bill_email_logs_scheduled_transaction_id_fkey" FOREIGN KEY ("scheduled_transaction_id") REFERENCES "scheduled_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
