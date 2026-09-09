-- CreateTable
-- Labels pinned to a quick-log button, applied to every transaction that button logs.
--
-- A pin overrides auto-apply label schedules for that tap. createTransactionBatch reads an
-- explicit labelIds as "the caller opted out of schedule matching", and that is the wanted
-- reading here: the user named these labels on this button, and a schedule guessing over a named
-- label moves money in getLabelBreakdown, which splits one amount across whatever labels a row
-- carries. A tile with no pins omits the field entirely -- never an empty array -- so schedules
-- keep running exactly as they did before this table existed.
--
-- Nothing is backfilled. Every existing tile starts with no pins, which is the current behaviour.
CREATE TABLE "telegram_quick_tile_labels" (
    "id" TEXT NOT NULL,
    "tile_id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_quick_tile_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One row per (tile, label) pair, matching transaction_labels and bill_labels. A second pin of
-- the same label is not a second application, it is the same fact stored twice.
CREATE UNIQUE INDEX "telegram_quick_tile_labels_tile_id_label_id_key" ON "telegram_quick_tile_labels"("tile_id", "label_id");

-- CreateIndex
CREATE INDEX "telegram_quick_tile_labels_tile_id_idx" ON "telegram_quick_tile_labels"("tile_id");

-- CreateIndex
CREATE INDEX "telegram_quick_tile_labels_label_id_idx" ON "telegram_quick_tile_labels"("label_id");

-- AddForeignKey
ALTER TABLE "telegram_quick_tile_labels" ADD CONSTRAINT "telegram_quick_tile_labels_tile_id_fkey" FOREIGN KEY ("tile_id") REFERENCES "telegram_quick_tiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- CASCADE on both sides, matching transaction_labels and bill_labels, and deliberately not the
-- SET NULL the tile's own category_id uses. The two are not the same case: a deleted category
-- must leave the button working, because the log path has a fallback ladder (resolveTileCategory)
-- to land it somewhere sensible. A deleted label has nothing to fall back to -- the pin stops
-- existing and the button reverts to whatever the user's schedules would have done anyway.
ALTER TABLE "telegram_quick_tile_labels" ADD CONSTRAINT "telegram_quick_tile_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
