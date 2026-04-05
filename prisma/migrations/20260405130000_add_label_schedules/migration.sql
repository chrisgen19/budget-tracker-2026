-- CreateTable
CREATE TABLE "label_schedules" (
    "id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "days" INTEGER[],
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "label_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "label_schedules_label_id_idx" ON "label_schedules"("label_id");

-- AddForeignKey
ALTER TABLE "label_schedules" ADD CONSTRAINT "label_schedules_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
