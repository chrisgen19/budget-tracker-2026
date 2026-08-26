-- AlterEnum
-- The provenance of a row written by the user's Telegram bot.
--
-- Every remote write arrives through /api/mcp, so the source cannot be derived from the endpoint:
-- doing that made the bot's rows claim Claude wrote them. It is taken from the credential instead,
-- via mcp_tokens.source, which the next migration adds.
ALTER TYPE "TransactionSource" ADD VALUE 'TELEGRAM';
