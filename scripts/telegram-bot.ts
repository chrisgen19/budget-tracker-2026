/**
 * Run the Telegram bot from the command line.
 *
 * A thin wrapper, the same shape as `mcp-server/src/index.ts`: the bot itself lives in
 * `src/lib/telegram/bot.ts` so the Next server can import it too, and one definition serves both
 * entry points rather than drifting into two.
 *
 * Only one poller may exist per bot token. Telegram answers a second concurrent `getUpdates` with
 * 409 Conflict, so do not run this while the deployed app has TELEGRAM_BOT_ENABLED set.
 */
import path from "path";

try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
} catch {
  // Already in process.env, or no .env file. Either is fine.
}

import("../src/lib/telegram/bot")
  .then(({ startTelegramBot }) => startTelegramBot())
  .catch((err) => {
    console.error("Fatal error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
