-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'FREE', 'PAID');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'FREE';
