-- The daily Watchlist digest on Telegram: a switch and a time on the user, one claimed row per day
-- sent, and one row per finding already sent (a hash of its key, never its text). Additive only.
ALTER TABLE "users" ADD COLUMN "telegram_watchlist_digest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "telegram_watchlist_digest_time" TEXT NOT NULL DEFAULT '08:00';

CREATE TABLE "telegram_watchlist_digests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sent_on" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_watchlist_digests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_watchlist_alerts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "finding_hash" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_watchlist_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_watchlist_digests_user_id_sent_on_key" ON "telegram_watchlist_digests"("user_id", "sent_on");
CREATE UNIQUE INDEX "telegram_watchlist_alerts_user_id_finding_hash_key" ON "telegram_watchlist_alerts"("user_id", "finding_hash");

ALTER TABLE "telegram_watchlist_digests" ADD CONSTRAINT "telegram_watchlist_digests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_watchlist_alerts" ADD CONSTRAINT "telegram_watchlist_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
