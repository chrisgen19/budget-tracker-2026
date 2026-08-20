-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterTable
-- Existing rows were only ever written on the success path, so SUCCESS is the
-- correct backfill value and keeps historical quota counts unchanged.
ALTER TABLE "scan_logs" ADD COLUMN "status" "ScanStatus" NOT NULL DEFAULT 'SUCCESS';

-- CreateIndex
CREATE INDEX "scan_logs_user_id_status_created_at_idx" ON "scan_logs"("user_id", "status", "created_at");
