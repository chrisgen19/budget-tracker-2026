-- CreateTable
CREATE TABLE "bill_labels" (
    "id" TEXT NOT NULL,
    "scheduled_transaction_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_labels_scheduled_transaction_id_idx" ON "bill_labels"("scheduled_transaction_id");

-- CreateIndex
CREATE INDEX "bill_labels_label_id_idx" ON "bill_labels"("label_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_labels_scheduled_transaction_id_label_id_key" ON "bill_labels"("scheduled_transaction_id", "label_id");

-- AddForeignKey
ALTER TABLE "bill_labels" ADD CONSTRAINT "bill_labels_scheduled_transaction_id_fkey" FOREIGN KEY ("scheduled_transaction_id") REFERENCES "scheduled_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_labels" ADD CONSTRAINT "bill_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
