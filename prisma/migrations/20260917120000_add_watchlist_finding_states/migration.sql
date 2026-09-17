CREATE TYPE "WatchlistFindingStatus" AS ENUM ('RESOLVED', 'SNOOZED');

CREATE TABLE "watchlist_finding_states" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "finding_hash" TEXT NOT NULL,
    "status" "WatchlistFindingStatus" NOT NULL,
    "snoozed_until" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watchlist_finding_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "watchlist_finding_states_user_id_finding_hash_key"
ON "watchlist_finding_states"("user_id", "finding_hash");
CREATE INDEX "watchlist_finding_states_user_id_status_snoozed_until_idx"
ON "watchlist_finding_states"("user_id", "status", "snoozed_until");

ALTER TABLE "watchlist_finding_states"
ADD CONSTRAINT "watchlist_finding_states_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
