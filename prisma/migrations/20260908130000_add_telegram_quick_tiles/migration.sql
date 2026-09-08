-- CreateTable
-- The Telegram Mini App's quick-log buttons, which are QUICK_FARES made into data.
--
-- A table rather than a Json column on "users" or another String[] of ids alongside
-- quick_expense_categories. Both of those hold a category id that nothing enforces -- the defect
-- quickPickIdsSchema papers over and scripts/prune-quick-category-ids.ts cleans up after -- and
-- neither has per-row identity, so renaming or deleting one button rewrites the whole array and
-- two edits in flight lose one. The Mini App edits these one at a time, which is the whole reason
-- they stopped being a hardcoded list.
--
-- "amount" is nullable and NULL is a real state: it means the button asks for an amount on the
-- numeric pad instead of logging one. There is deliberately no "kind" column beside it, because
-- that states the same fact twice and the two can disagree.
CREATE TABLE "telegram_quick_tiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "type" "TransactionType" NOT NULL DEFAULT 'EXPENSE',
    "category_id" TEXT,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_quick_tiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Two buttons reading the same thing are indistinguishable in a grid, so a duplicate is refused
-- with a named cause rather than accepted as a second identical tile.
CREATE UNIQUE INDEX "telegram_quick_tiles_user_id_label_key" ON "telegram_quick_tiles"("user_id", "label");

-- CreateIndex
CREATE INDEX "telegram_quick_tiles_user_id_sort_order_idx" ON "telegram_quick_tiles"("user_id", "sort_order");

-- AddForeignKey
ALTER TABLE "telegram_quick_tiles" ADD CONSTRAINT "telegram_quick_tiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL, and it is neither of the two rules already used in this schema. transactions.category
-- is RESTRICT, because a transaction with no category is meaningless. The user relation above is
-- CASCADE, because the row belongs to them. A button is neither: deleting a category must not
-- delete the buttons that referenced it, which would read as data loss from an unrelated action,
-- and must not be blocked by them either. The tile survives with a null category and the log path
-- falls back to matchCategory, which is what the shorthand path has always done.
ALTER TABLE "telegram_quick_tiles" ADD CONSTRAINT "telegram_quick_tiles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
