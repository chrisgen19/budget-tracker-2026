/**
 * Server startup hook. Next runs this once, before the app handles any request.
 *
 * Its only job today is the Telegram bot. The bot lives here rather than in a second Coolify
 * application because it is a single-user personal bot: isolating it would double the build and
 * the memory on the same VPS to protect an app that only its owner uses. Importing it also means
 * Next traces the module into `.next/standalone` at build time, so the deployed container needs
 * neither `tsx` nor `scripts/`.
 */
export async function register(): Promise<void> {
  // Only the Node runtime has sockets and long-lived timers. The edge runtime imports this file
  // too, and a bot cannot run there.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Off unless explicitly enabled, which is what keeps local development safe: Telegram answers a
  // second concurrent `getUpdates` for the same token with 409 Conflict, so a `pnpm dev` that
  // started its own poller would fight the deployed one and both would misbehave. Set this only
  // in the deployed environment.
  if (process.env.TELEGRAM_BOT_ENABLED !== "true") return;

  try {
    const { startTelegramBot } = await import("@/lib/telegram/bot");

    // Deliberately not awaited: the bot polls forever, and awaiting it here would block Next from
    // finishing startup. Its own failures are caught below so a misconfigured bot degrades to "no
    // bot" rather than taking the budget app down with it.
    void startTelegramBot().catch((err) => {
      console.error(
        "[telegram] bot stopped:",
        err instanceof Error ? err.message : err,
        "\nThe app is unaffected. Fix the configuration and redeploy to restart it."
      );
    });
  } catch (err) {
    console.error(
      "[telegram] bot failed to start:",
      err instanceof Error ? err.message : err
    );
  }
}
