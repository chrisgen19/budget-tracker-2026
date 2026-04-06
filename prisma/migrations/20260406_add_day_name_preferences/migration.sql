-- CreateEnum
CREATE TYPE "DayNameFormat" AS ENUM ('FULL', 'SHORT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "show_day_name" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "day_name_format" "DayNameFormat" NOT NULL DEFAULT 'SHORT';
