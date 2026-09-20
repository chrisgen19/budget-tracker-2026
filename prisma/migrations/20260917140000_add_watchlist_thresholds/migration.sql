-- The defaults are the constants the detectors already shipped with, so an existing account
-- behaves identically until somebody changes one.
ALTER TABLE "users"
ADD COLUMN "watchlist_outlier_ratio" DOUBLE PRECISION NOT NULL DEFAULT 3,
ADD COLUMN "watchlist_large_amount" DOUBLE PRECISION,
ADD COLUMN "watchlist_duplicate_alerts" BOOLEAN NOT NULL DEFAULT true;
