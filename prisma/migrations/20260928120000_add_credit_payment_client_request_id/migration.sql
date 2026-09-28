-- An idempotency key on card payments, so a Record retried after a lost response replays the saved
-- row instead of lowering the balance twice. Expand only: a nullable column, and a unique index that
-- every existing row satisfies because Postgres treats NULLs as distinct. The release still serving
-- during the deploy writes no key, so its inserts stay NULL and never collide.
ALTER TABLE "credit_payments" ADD COLUMN "client_request_id" TEXT;

CREATE UNIQUE INDEX "credit_payments_user_id_client_request_id_key" ON "credit_payments"("user_id", "client_request_id");
