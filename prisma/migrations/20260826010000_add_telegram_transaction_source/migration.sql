-- AlterEnum
-- Reserved for a writer that reaches the database without going through /api/mcp. The Telegram
-- bot no longer does, so nothing sets this yet: rows it creates arrive over MCP and are stamped
-- MCP with the bot's own token id. Kept because the value is additive and harmless, Postgres
-- cannot drop an enum value without recreating the type, and the follow-up that would use it
-- (deriving created_via from the token, so a Telegram token stamps TELEGRAM rather than every
-- client looking like Claude) needs it.
ALTER TYPE "TransactionSource" ADD VALUE 'TELEGRAM';
