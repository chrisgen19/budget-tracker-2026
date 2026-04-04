-- CreateTable
CREATE TABLE "labels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_labels" (
    "id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labels_name_user_id_key" ON "labels"("name", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_labels_transaction_id_label_id_key" ON "transaction_labels"("transaction_id", "label_id");

-- CreateIndex
CREATE INDEX "transaction_labels_transaction_id_idx" ON "transaction_labels"("transaction_id");

-- CreateIndex
CREATE INDEX "transaction_labels_label_id_idx" ON "transaction_labels"("label_id");

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_labels" ADD CONSTRAINT "transaction_labels_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_labels" ADD CONSTRAINT "transaction_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
