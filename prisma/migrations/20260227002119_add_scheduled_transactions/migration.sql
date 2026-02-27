-- CreateEnum
CREATE TYPE "BillFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'ANNUALLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BillOccurrenceStatus" AS ENUM ('PAID', 'SKIPPED', 'SNOOZED');

-- CreateTable
CREATE TABLE "scheduled_transactions" (
    "id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" "TransactionType" NOT NULL,
    "frequency" "BillFrequency" NOT NULL,
    "custom_interval_days" INTEGER,
    "reminder_days_before" INTEGER NOT NULL DEFAULT 0,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "next_due_date" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "category_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_transaction_logs" (
    "id" TEXT NOT NULL,
    "scheduled_transaction_id" TEXT NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" "BillOccurrenceStatus" NOT NULL,
    "action_date" TIMESTAMP(3),
    "transaction_id" TEXT,
    "snooze_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_transaction_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_transactions_user_id_next_due_date_idx" ON "scheduled_transactions"("user_id", "next_due_date");

-- CreateIndex
CREATE INDEX "scheduled_transactions_user_id_is_active_idx" ON "scheduled_transactions"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "scheduled_transaction_logs_scheduled_transaction_id_due_dat_idx" ON "scheduled_transaction_logs"("scheduled_transaction_id", "due_date");

-- CreateIndex
CREATE INDEX "scheduled_transaction_logs_scheduled_transaction_id_status_idx" ON "scheduled_transaction_logs"("scheduled_transaction_id", "status");

-- AddForeignKey
ALTER TABLE "scheduled_transactions" ADD CONSTRAINT "scheduled_transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_transactions" ADD CONSTRAINT "scheduled_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_transaction_logs" ADD CONSTRAINT "scheduled_transaction_logs_scheduled_transaction_id_fkey" FOREIGN KEY ("scheduled_transaction_id") REFERENCES "scheduled_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
