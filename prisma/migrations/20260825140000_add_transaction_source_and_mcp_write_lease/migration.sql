-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('APP', 'MCP');

-- AlterTable
-- Every existing row was written through the app: the MCP endpoint has been read-only since it
-- shipped, so APP is the correct backfill and no row is mislabelled by it.
ALTER TABLE "transactions" ADD COLUMN     "created_via" "TransactionSource" NOT NULL DEFAULT 'APP';

-- AlterTable
-- Nullable, and deliberately not a foreign key: the audit record must outlive the credential, so
-- deleting or revoking a token cannot cascade away the evidence of what it wrote.
ALTER TABLE "transactions" ADD COLUMN     "mcp_token_id" TEXT;

-- AlterTable
-- Write lease for the MCP endpoint. Null means writes are off, which is the safe default for
-- every existing user.
ALTER TABLE "users" ADD COLUMN     "mcp_writes_enabled_until" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "transactions_user_id_created_via_idx" ON "transactions"("user_id", "created_via");
