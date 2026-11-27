-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "receipt_photo_id" TEXT;

-- CreateTable
CREATE TABLE "receipt_photos" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "photo_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_photos_object_key_key" ON "receipt_photos"("object_key");

-- CreateIndex
CREATE INDEX "receipt_photos_user_id_idx" ON "receipt_photos"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_photos_user_id_photo_key_key" ON "receipt_photos"("user_id", "photo_key");

-- CreateIndex
CREATE INDEX "transactions_receipt_photo_id_idx" ON "transactions"("receipt_photo_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_receipt_photo_id_fkey" FOREIGN KEY ("receipt_photo_id") REFERENCES "receipt_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_photos" ADD CONSTRAINT "receipt_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
