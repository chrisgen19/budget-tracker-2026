/**
 * Stopping the poll loop deliberately, rather than being killed mid-update.
 *
 * The bot ran as a bare `while (true)` with no exit path, so SIGTERM killed the process wherever
 * it happened to be — including part-way through `handleMessage`. That matters because of how
 * Telegram acknowledges work: advancing the local `offset` confirms nothing, and an update is only
 * settled once the *next* `getUpdates` is called with a higher offset. A container killed mid-
 * handler therefore leaves its whole batch unconfirmed, and the replacement container is handed it
 * again (see #165).
 *
 * Replays are survivable for writes — `create_transactions` is keyed on the update id — but
 * `scan_receipt` is deliberately not idempotent, so a receipt in flight during a deploy is scanned
 * and charged twice.
 *
 * Two things have to be true for a clean stop, and they pull in opposite directions:
 *
 *  - an *idle* loop is parked in a 20-second long poll, and Docker's default grace period before
 *    SIGKILL is 10 seconds, so waiting for that poll to return is waiting too long. The request
 *    has to be abortable.
 *  - a *busy* loop is mid-handler, and that work must finish, because abandoning it is the thing
 *    this exists to prevent.
 *
 * So the flag is checked between updates, an idle poll is interrupted, and a busy one is left to
 * complete before the loop exits and confirms.
 *
 * This is a courtesy, not the guarantee. The correctness of #165 rests on each update being
 * confirmed the moment its handler returns, which needs no signal at all and therefore survives
 * SIGKILL and an OOM kill too. It has to: the bot runs inside the Next server, and Next's own
 * signal handler calls `process.exit(0)` once the HTTP server closes, so anything asynchronous
 * this schedules is racing that exit. What a clean stop still buys is not finishing a handler
 * halfway and not leaving the final batch unconfirmed when the race is won.
 */
export interface ShutdownState {
  /** True once a stop has been requested. Checked between updates. */
  requested: boolean;
  /** Set while a handler is running, so an idle poll can be aborted and a busy one cannot. */
  handling: boolean;
  /** Aborts the in-flight long poll. Present only while one is parked. */
  abortIdlePoll?: () => void;
}

export const newShutdownState = (): ShutdownState => ({ requested: false, handling: false });

/**
 * Record a stop request, and interrupt an idle poll so the loop reaches its exit promptly.
 *
 * Returns what was decided, which is what the log line reports: a request that arrives while a
 * handler is running waits for it, and one that arrives while parked does not.
 */
export const requestShutdown = (state: ShutdownState): "aborted_idle_poll" | "awaiting_handler" => {
  state.requested = true;

  if (!state.handling && state.abortIdlePoll) {
    state.abortIdlePoll();
    return "aborted_idle_poll";
  }
  return "awaiting_handler";
};

/**
 * Whether the loop should stop before taking the next update.
 *
 * Deliberately checked *between* updates rather than inside a handler: a half-finished update is
 * exactly the state that causes the double scan.
 */
export const shouldStop = (state: ShutdownState): boolean => state.requested;
