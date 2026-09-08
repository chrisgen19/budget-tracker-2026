-- AlterTable
-- Links a Telegram account to an app user, which nothing in this schema did before.
--
-- The bot never needed it: it writes through an MCP token that is already bound to a user, and
-- TELEGRAM_ALLOWED_IDS answers "may this person talk to the bot", never "who are they here". The
-- Mini App cannot borrow that arrangement -- its page runs in a browser, and an MCP token shipped
-- to a client is a leaked credential -- so it authenticates with Telegram's signed initData, which
-- carries a Telegram id and nothing else. This column is what turns that id into an account.
--
-- Nullable, because null is the right state for every account that does not use Telegram, and it
-- is set by hand once (scripts/link-telegram-user.ts) rather than through a linking flow built for
-- a single person.
ALTER TABLE "users" ADD COLUMN     "telegram_user_id" TEXT;

-- CreateIndex
-- Unique so two app users cannot claim the same Telegram account, which would make "who is this
-- request from" ambiguous at exactly the point it must not be. Postgres treats NULLs as distinct,
-- so this constrains linked rows only and leaves every unlinked account alone.
CREATE UNIQUE INDEX "users_telegram_user_id_key" ON "users"("telegram_user_id");
