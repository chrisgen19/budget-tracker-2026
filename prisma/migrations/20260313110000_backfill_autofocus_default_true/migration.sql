-- Repair the column default for environments that previously applied
-- transaction_amount_autofocus with DEFAULT false. Do not rewrite stored
-- false values here because they may now reflect real user opt-outs.
ALTER TABLE "users"
ALTER COLUMN "transaction_amount_autofocus" SET DEFAULT true;
