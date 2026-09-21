-- Interest terms for a credit card. All nullable: absent means unknown, and a projection that
-- needs one is withheld rather than computed with a stand-in. `apr = 0` is a real 0% plan and is
-- deliberately distinct from NULL, so none of these carry a default.
ALTER TABLE "credit_accounts" ADD COLUMN "apr" DOUBLE PRECISION;
ALTER TABLE "credit_accounts" ADD COLUMN "minimum_payment_pct" DOUBLE PRECISION;
ALTER TABLE "credit_accounts" ADD COLUMN "minimum_payment_floor" DOUBLE PRECISION;
ALTER TABLE "credit_accounts" ADD COLUMN "planned_payment" DOUBLE PRECISION;
