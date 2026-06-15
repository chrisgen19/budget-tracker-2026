-- CreateEnum
CREATE TYPE "AiInsightKind" AS ENUM ('REPORT', 'DAILY_TIP');

-- CreateTable
CREATE TABLE "ai_assessments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "AiInsightKind" NOT NULL,
    "period_key" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "sources" JSONB,
    "model" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "AiInsightKind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_assessments_user_id_idx" ON "ai_assessments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_assessments_user_id_kind_period_key_key" ON "ai_assessments"("user_id", "kind", "period_key");

-- CreateIndex
CREATE INDEX "ai_usage_logs_user_id_created_at_idx" ON "ai_usage_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_assessments" ADD CONSTRAINT "ai_assessments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
