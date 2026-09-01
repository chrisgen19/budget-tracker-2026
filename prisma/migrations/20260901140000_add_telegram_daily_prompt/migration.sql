-- AlterTable
-- The evening Telegram prompt, off by default so an existing account is never messaged without
-- asking. The time is stored per user rather than encoded in a cron expression: Coolify tasks run
-- in the container, which is UTC, so 20:00 Asia/Manila is 12:00 UTC and a weekday there is not
-- reliably a weekday here. Keeping it as data means the schedule is testable and the cron entry
-- never has to change again.
ALTER TABLE "users" ADD COLUMN     "telegram_daily_prompt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telegram_daily_prompt_time" TEXT NOT NULL DEFAULT '20:00';

-- CreateTable
-- One row per day the prompt was sent. The cron fires every 15 minutes and the prompt is due
-- once a day, so the unique index below is what makes the send idempotent; a read-then-filter
-- would race two overlapping ticks. `prompted_on` is the user's local calendar day encoded at
-- UTC midnight, date-only like a bill due date, and is never converted back through a timezone.
CREATE TABLE "telegram_prompt_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "prompted_on" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_prompt_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_prompt_logs_user_id_prompted_on_key" ON "telegram_prompt_logs"("user_id", "prompted_on");

-- AddForeignKey
ALTER TABLE "telegram_prompt_logs" ADD CONSTRAINT "telegram_prompt_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
