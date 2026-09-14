-- CreateTable
-- Restricts a label to the categories it is linked to. Before this table a label was offered on
-- every transaction of a compatible type, so choosing Transportation still offered Shopee, and
-- the list only grew as labels were added.
--
-- ZERO ROWS MEANS EVERY CATEGORY, not none. That is the whole backward-compatibility story and
-- the reason nothing is backfilled: every label that predates this table has no rows here and
-- keeps behaving exactly as it did, the same way applicable_to's "BOTH" default leaves a label
-- unrestricted by transaction type. The two compose -- a label must pass both checks -- and the
-- single predicate is labelAllowsCategory in src/lib/label-category-matching.ts. Do not re-derive
-- the empty-means-all rule at a call site.
--
-- The empty set is not reachable by hand: the label form requires at least one category once
-- "Specific categories" is chosen. It is reachable by cascade, and that is deliberate -- see the
-- category_id foreign key below.
CREATE TABLE "label_categories" (
    "id" TEXT NOT NULL,
    "label_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "label_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One row per (label, category) pair, matching transaction_labels, bill_labels and
-- telegram_quick_tile_labels. Linking the same category twice is the same fact stored twice, and
-- a duplicate would also inflate the "restricted to N categories" count the label card shows.
CREATE UNIQUE INDEX "label_categories_label_id_category_id_key" ON "label_categories"("label_id", "category_id");

-- CreateIndex
CREATE INDEX "label_categories_label_id_idx" ON "label_categories"("label_id");

-- CreateIndex
CREATE INDEX "label_categories_category_id_idx" ON "label_categories"("category_id");

-- AddForeignKey
ALTER TABLE "label_categories" ADD CONSTRAINT "label_categories_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- CASCADE, which means deleting a label's last linked category silently makes that label
-- unrestricted again. That is the deliberate direction to fail in, not an oversight. A category
-- can only be deleted while no transaction uses it (DELETE /api/categories/[id] refuses
-- otherwise), so the blast radius is small, and a label that starts appearing everywhere is
-- visible and re-narrowable. The alternative -- keeping an explicit "restricted" flag so the set
-- could go empty -- leaves a label that matches nothing and simply disappears from every picker
-- with no way to notice why.
--
-- RESTRICT would be worse still: it would make an unused category undeletable because some label
-- once pointed at it.
ALTER TABLE "label_categories" ADD CONSTRAINT "label_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
