-- AlterTable
ALTER TABLE "users" ADD COLUMN "quick_labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
