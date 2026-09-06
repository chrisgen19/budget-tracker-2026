-- AlterTable
-- Which surface last *edited* this row, for the MCP `update_transactions` tool and the app's own
-- edit form.
--
-- Nullable with no default, unlike `created_via`, which backfilled every existing row to APP.
-- That backfill was correct: every row that existed had in fact been created through the app. The
-- equivalent claim here would be false — no row has been *edited* through anything yet — and a
-- default of APP would assert an edit that never happened for the entire table. Null means "not
-- edited since this column existed", which is the only honest backfill.
--
-- Separate from `created_via` rather than replacing it: a row typed into the app and later
-- corrected over MCP is both APP-created and MCP-edited, and one column cannot say that.
ALTER TABLE "transactions" ADD COLUMN     "updated_via" "TransactionSource";

-- AlterTable
-- Which MCP token last edited this row. Nullable and deliberately not a foreign key, for the same
-- reason `mcp_token_id` is not: the audit record has to outlive the credential, so revoking or
-- deleting a token must not cascade away the evidence of what it did.
ALTER TABLE "transactions" ADD COLUMN     "updated_by_mcp_token_id" TEXT;

-- CreateIndex
-- Mirrors `transactions_user_id_created_via_idx`, so "what did a token change?" is as answerable
-- after the fact as "what did it write?".
CREATE INDEX "transactions_user_id_updated_via_idx" ON "transactions"("user_id", "updated_via");
