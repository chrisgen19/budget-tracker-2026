-- AlterTable: add applicableTo to labels (defaults to BOTH for backwards compatibility)
ALTER TABLE "labels" ADD COLUMN "applicable_to" TEXT NOT NULL DEFAULT 'BOTH';

-- AlterTable: add defaultLabelType user preference (defaults to EXPENSE)
ALTER TABLE "users" ADD COLUMN "default_label_type" TEXT NOT NULL DEFAULT 'EXPENSE';
