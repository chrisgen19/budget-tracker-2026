-- Whether a bill's cost varies month to month: a metered utility rather than a
-- fixed contract. `amount` stays NOT NULL and keeps working as a fallback, so
-- every existing bill is unaffected; what changes for a variable one is that the
-- reminder asserts no figure and the forecast derives an estimate from the
-- payments already linked to the bill (#217).
ALTER TABLE "scheduled_transactions" ADD COLUMN "is_variable" BOOLEAN NOT NULL DEFAULT false;
