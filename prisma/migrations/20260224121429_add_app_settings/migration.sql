-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "receipt_scan_enabled" BOOLEAN NOT NULL DEFAULT false,
    "max_upload_files" INTEGER NOT NULL DEFAULT 10,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_role_key" ON "app_settings"("role");
