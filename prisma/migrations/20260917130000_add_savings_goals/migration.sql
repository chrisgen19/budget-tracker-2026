CREATE TYPE "SavingsGoalKind" AS ENUM ('GOAL', 'SINKING_FUND');
CREATE TYPE "SavingsGoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'ARCHIVED');

CREATE TABLE "savings_goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SavingsGoalKind" NOT NULL DEFAULT 'GOAL',
    "target_amount" DOUBLE PRECISION NOT NULL,
    "target_date" TIMESTAMP(3),
    "status" "SavingsGoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_goals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "savings_goals_user_id_name_key" ON "savings_goals"("user_id", "name");
CREATE INDEX "savings_goals_user_id_status_idx" ON "savings_goals"("user_id", "status");

ALTER TABLE "savings_goals"
ADD CONSTRAINT "savings_goals_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "savings_goal_contributions" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savings_goal_contributions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "savings_goal_contributions_goal_id_date_idx"
ON "savings_goal_contributions"("goal_id", "date");

ALTER TABLE "savings_goal_contributions"
ADD CONSTRAINT "savings_goal_contributions_goal_id_fkey"
FOREIGN KEY ("goal_id") REFERENCES "savings_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
