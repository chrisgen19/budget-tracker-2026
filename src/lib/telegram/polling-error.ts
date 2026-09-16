/**
 * Deciding what a polling failure is worth saying, so a deploy handover does not read as an
 * incident.
 *
 * Telegram allows one `getUpdates` per bot token and answers a second with 409 Conflict,
 * terminating the other call. Coolify starts the replacement container before it stops the old
 * one, so for the length of that handover two pollers are live and each kills the other. The loop
 * logs, sleeps three seconds and retries, which printed five identical lines on every deploy:
 *
 *   [telegram] polling error: Conflict: terminated by other getUpdates request; make sure that
 *   only one bot instance is running
 *
 * That case is expected and self-healing - the old container goes away and the next poll
 * succeeds. The problem is that the genuinely broken case prints the *same line*: a second
 * deployment on the same token, or a dev machine left with `TELEGRAM_BOT_ENABLED=true`. One
 * resolves in seconds and the other never does, and the log gave no way to tell them apart. It
 * cost an investigation into a second instance that did not exist.
 *
 * So the two are separated by how long the conflicts have been going on, not by how many there
 * have been. A handover is bounded by container shutdown; a second poller is not.
 *
 * The streak is measured rather than the process uptime on purpose. Both containers see the
 * conflict during a handover, and the outgoing one has been up for hours, so uptime would report
 * a false alarm on exactly the instance that is about to exit anyway.
 *
 * A success does **not** end the run on its own, and that is the subtle part. Telegram terminates
 * the *earlier* `getUpdates` when a second arrives, so two live pollers alternate: each one's call
 * is the live one for as long as the other is in its three-second backoff, and an update landing in
 * that window comes back as an ordinary success while the competitor is still running. Clearing on
 * that success restarted the window, which suppressed the escalation exactly when traffic was
 * flowing -- when the split matters most -- and, because the next conflict then looked like the
 * first of a fresh run, printed the handover line again. Measured over ten minutes of sustained
 * conflict with one success a minute: nine "expected while a deploy hands over" lines and no
 * escalation at all. So a run ends only once conflicts have actually *stopped* for
 * `CONFLICT_QUIET_MS`, which is what distinguishes a handover (they stop, permanently) from a
 * second poller (they keep coming, whatever succeeds in between).
 */

/**
 * How long conflicts may continue before they stop being a handover. A deploy's overlap is tens of
 * seconds: the observed window was 07:37:34 to 07:38:02, ending when the old container stopped.
 * Generous against that, because the cost of being late is a delayed log line, while the cost of
 * being early is crying wolf on every deploy - the thing this exists to prevent.
 */
export const CONFLICT_HANDOVER_MS = 90_000;

/**
 * Once a conflict is established as persistent, repeat it every this many retries rather than on
 * each one. At the loop's three-second backoff that is roughly every five minutes: frequent enough
 * that a stuck bot is visible in a log tail, rare enough not to bury everything else.
 */
export const CONFLICT_REPEAT_EVERY = 100;

/**
 * How long conflicts must have *stopped* before a success is allowed to end the run.
 *
 * Comfortably longer than the three-to-seven seconds at which two competing pollers produce them,
 * so a fight can never clear itself, and short enough that a handover clears within a few polls of
 * the old container going away -- an idle `getUpdates` returns an empty array every 20s, so that is
 * roughly three polls. It must stay well below `CONFLICT_HANDOVER_MS`, or a finished handover could
 * keep a stale `startedAt` long enough for the next unrelated conflict to escalate on arrival.
 */
export const CONFLICT_QUIET_MS = 60_000;

export interface PollingErrorLog {
  level: "info" | "error";
  message: string;
}

/**
 * The current run of consecutive 409s. Ended by any other error, and by a success only once
 * conflicts have been quiet for `CONFLICT_QUIET_MS`.
 */
export interface ConflictStreak {
  /** Conflicts in this run, including the one being reported. 0 when there is no run. */
  count: number;
  /** `Date.now()` when the run began. Meaningless while `count` is 0. */
  startedAt: number;
  /** `Date.now()` of the most recent conflict, which is what a success is judged against. */
  lastConflictAt: number;
  /** Whether this run has already been reported as outlasting a handover. */
  escalated: boolean;
}

export const newConflictStreak = (): ConflictStreak => ({
  count: 0,
  startedAt: 0,
  lastConflictAt: 0,
  escalated: false,
});

/**
 * Telegram phrases this as "Conflict: terminated by other getUpdates request". Matched on the
 * word rather than the whole sentence, since the wording is theirs to change and the
 * classification should survive it.
 */
export const isConflictError = (message: string): boolean => /\bconflict\b/i.test(message);

/** End the run outright, so a later handover is judged on its own duration. */
export const clearConflictStreak = (streak: ConflictStreak): void => {
  streak.count = 0;
  streak.startedAt = 0;
  streak.lastConflictAt = 0;
  streak.escalated = false;
};

/**
 * Fold a successful poll into the streak.
 *
 * Ends the run only once conflicts have stopped for `CONFLICT_QUIET_MS`. A success while they are
 * still arriving proves nothing about ownership -- with two pollers each one's call is live between
 * the other's retries -- so the run is left to keep accumulating. Returns whether the run ended,
 * which the tests assert on and nothing else needs.
 */
export const recordPollingSuccess = (streak: ConflictStreak, now: number): boolean => {
  if (streak.count === 0) return false;
  if (now - streak.lastConflictAt < CONFLICT_QUIET_MS) return false;
  clearConflictStreak(streak);
  return true;
};

/**
 * Fold a failure into the streak and return what to log, or `null` to stay quiet.
 *
 * `null` is only ever returned for a conflict whose run has already been reported. Every other
 * failure logs every time: those are not self-healing, and their text varies.
 */
export function recordPollingError(
  streak: ConflictStreak,
  message: string,
  now: number,
): PollingErrorLog | null {
  if (!isConflictError(message)) {
    clearConflictStreak(streak);
    return { level: "error", message: `polling error: ${message}` };
  }

  if (streak.count === 0) {
    streak.startedAt = now;
  }
  streak.count += 1;
  streak.lastConflictAt = now;

  const elapsed = now - streak.startedAt;

  if (elapsed <= CONFLICT_HANDOVER_MS) {
    // Said once per run, not once per retry: the retries are the same fact.
    if (streak.count > 1) return null;
    return {
      level: "info",
      message:
        "another poller holds this bot token; retrying. Expected while a deploy hands over, and " +
        "it clears when the previous container stops.",
    };
  }

  // Report on the retry that crosses the window, then periodically, so a stuck bot neither waits
  // for a round number nor repeats every three seconds.
  const shouldReport = !streak.escalated || streak.count % CONFLICT_REPEAT_EVERY === 0;
  streak.escalated = true;
  if (!shouldReport) return null;

  return {
    level: "error",
    message:
      `another poller has held this bot token for ${Math.round(elapsed / 1000)}s, longer than a ` +
      "deploy handover. Only one getUpdates per token is allowed, so this bot is receiving an " +
      "arbitrary share of updates. Look for a second deployment on the same TELEGRAM_BOT_TOKEN, " +
      "or a machine running the bot with TELEGRAM_BOT_ENABLED=true.",
  };
}
