-- AlterEnum
-- The Telegram bot writes through the same shared writer as the app and the MCP endpoint, so it
-- needs its own provenance value. Reusing MCP would claim Claude wrote rows that came from a chat
-- message, which is the false attribution `created_via` exists to prevent; leaving them APP would
-- make them indistinguishable from rows typed into the app by hand.
ALTER TYPE "TransactionSource" ADD VALUE 'TELEGRAM';
