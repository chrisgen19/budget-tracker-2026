-- AlterTable
-- What a token represents, stamped onto every row it writes. Existing tokens are assistants
-- reaching the endpoint over MCP, so MCP is the correct backfill and no row changes meaning.
ALTER TABLE "mcp_tokens" ADD COLUMN     "source" "TransactionSource" NOT NULL DEFAULT 'MCP';
