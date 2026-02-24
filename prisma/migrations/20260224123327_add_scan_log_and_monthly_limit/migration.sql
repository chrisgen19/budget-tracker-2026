-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "monthly_scan_limit" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "scan_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scan_logs_user_id_created_at_idx" ON "scan_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "scan_logs" ADD CONSTRAINT "scan_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
