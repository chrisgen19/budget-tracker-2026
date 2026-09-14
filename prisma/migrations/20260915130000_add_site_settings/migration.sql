-- App-wide switches, starting with who can use credit cards.
--
-- No row is inserted: a missing row reads as every default (credit cards for admins only), so
-- production gets the safe setting the moment this deploys and an admin opts everyone in.

-- CreateEnum
CREATE TYPE "FeatureAccess" AS ENUM ('ADMIN', 'EVERYONE');

-- CreateTable
CREATE TABLE "site_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "credit_cards_access" "FeatureAccess" NOT NULL DEFAULT 'ADMIN',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);
