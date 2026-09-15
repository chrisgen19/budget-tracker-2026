-- Monthly plans are immutable revisions. A save inserts a new budget_plans row and a complete
-- allocation snapshot, which lets historical analytics identify the exact plan it used instead
-- of silently rewriting the past.
CREATE TYPE "BudgetAllocationKind" AS ENUM ('INCOME', 'FIXED', 'FLEXIBLE', 'SAVINGS');

CREATE TABLE "budget_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "budget_allocations" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "kind" "BudgetAllocationKind" NOT NULL,
    "rollover_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "budget_plans_user_id_month_revision_key"
ON "budget_plans"("user_id", "month", "revision");
CREATE INDEX "budget_plans_user_id_month_created_at_idx"
ON "budget_plans"("user_id", "month", "created_at");
CREATE UNIQUE INDEX "budget_allocations_plan_id_category_id_key"
ON "budget_allocations"("plan_id", "category_id");
CREATE INDEX "budget_allocations_category_id_idx"
ON "budget_allocations"("category_id");

ALTER TABLE "budget_plans"
ADD CONSTRAINT "budget_plans_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "budget_allocations"
ADD CONSTRAINT "budget_allocations_plan_id_fkey"
FOREIGN KEY ("plan_id") REFERENCES "budget_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "budget_allocations"
ADD CONSTRAINT "budget_allocations_category_id_fkey"
FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
