-- AlterColumn: make days NOT NULL to match Prisma schema (Int[] is required)
-- Default existing NULLs to empty array first
UPDATE "label_schedules" SET "days" = '{}' WHERE "days" IS NULL;
ALTER TABLE "label_schedules" ALTER COLUMN "days" SET NOT NULL;
