import { describe, expect, it } from "vitest";
import {
  CONFLICT_HANDOVER_MS,
  CONFLICT_REPEAT_EVERY,
  clearConflictStreak,
  isConflictError,
  newConflictStreak,
  recordPollingError,
} from "@/lib/telegram/polling-error";

/**
 * What matters here is the distinction, not the wording: a deploy handover and a second poller
 * produced the identical line, and the whole point is that they no longer do.
 */

const CONFLICT =
  "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running";

/** The loop's own backoff, so a streak advances at the rate production does. */
const BACKOFF_MS = 3000;

describe("isConflictError", () => {
  it("matches Telegram's wording", () => {
    expect(isConflictError(CONFLICT)).toBe(true);
  });

  it("matches on the word alone, so a reworded message still classifies", () => {
    expect(isConflictError("409 conflict")).toBe(true);
  });

  it("does not match unrelated failures", () => {
    expect(isConflictError("socket hang up")).toBe(false);
    expect(isConflictError("Unauthorized")).toBe(false);
  });
});

describe("recordPollingError: a deploy handover", () => {
  it("reports the first conflict once, as expected rather than as an error", () => {
    const streak = newConflictStreak();
    const log = recordPollingError(streak, CONFLICT, 1_000);

    expect(log?.level).toBe("info");
    expect(log?.message).toContain("Expected while a deploy hands over");
  });

  it("stays quiet for the retries, which are the same fact", () => {
    const streak = newConflictStreak();
    recordPollingError(streak, CONFLICT, 0);

    for (let i = 1; i <= 5; i += 1) {
      expect(recordPollingError(streak, CONFLICT, i * BACKOFF_MS)).toBeNull();
    }
  });

  it("produces exactly one line across the window observed in production", () => {
    // 07:37:34 to 07:38:02, five conflicts at the loop's backoff.
    const streak = newConflictStreak();
    const logs = [0, 7_000, 14_000, 21_000, 28_000]
      .map((t) => recordPollingError(streak, CONFLICT, t))
      .filter((l) => l !== null);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe("info");
  });
});

describe("recordPollingError: a second poller", () => {
  it("escalates on the retry that outlasts the handover window", () => {
    const streak = newConflictStreak();
    recordPollingError(streak, CONFLICT, 0);

    const log = recordPollingError(streak, CONFLICT, CONFLICT_HANDOVER_MS + 1);

    expect(log?.level).toBe("error");
    expect(log?.message).toContain("TELEGRAM_BOT_ENABLED=true");
  });

  it("escalates without waiting for a multiple of the repeat interval", () => {
    const streak = newConflictStreak();
    recordPollingError(streak, CONFLICT, 0);
    // Second conflict of the run, so `count` is 2 and nowhere near CONFLICT_REPEAT_EVERY.
    const log = recordPollingError(streak, CONFLICT, CONFLICT_HANDOVER_MS + BACKOFF_MS);

    expect(streak.count).toBe(2);
    expect(log?.level).toBe("error");
  });

  it("names how long it has been going on", () => {
    const streak = newConflictStreak();
    recordPollingError(streak, CONFLICT, 0);
    const log = recordPollingError(streak, CONFLICT, 120_000);

    expect(log?.message).toContain("120s");
  });

  it("then repeats periodically rather than on every retry", () => {
    const streak = newConflictStreak();
    let now = 0;
    recordPollingError(streak, CONFLICT, now);

    // Past the window, so every subsequent call is in the escalated branch.
    now = CONFLICT_HANDOVER_MS + BACKOFF_MS;
    const reported: number[] = [];
    for (let i = 0; i < CONFLICT_REPEAT_EVERY * 2; i += 1) {
      now += BACKOFF_MS;
      if (recordPollingError(streak, CONFLICT, now)) reported.push(streak.count);
    }

    // One on crossing, then one per interval - not 200 lines.
    expect(reported.length).toBeLessThan(5);
    expect(reported).toContain(CONFLICT_REPEAT_EVERY);
  });
});

describe("recordPollingError: everything else", () => {
  it("logs other failures every time, since they do not self-heal", () => {
    const streak = newConflictStreak();

    for (const t of [0, BACKOFF_MS, BACKOFF_MS * 2]) {
      const log = recordPollingError(streak, "socket hang up", t);
      expect(log).toEqual({ level: "error", message: "polling error: socket hang up" });
    }
  });

  it("resets the run, so a conflict after another failure is judged on its own duration", () => {
    const streak = newConflictStreak();
    recordPollingError(streak, CONFLICT, 0);
    recordPollingError(streak, "socket hang up", BACKOFF_MS);

    const log = recordPollingError(streak, CONFLICT, CONFLICT_HANDOVER_MS);

    // Without the reset this would be measured from 0 and escalate.
    expect(log?.level).toBe("info");
  });

  it("treats a success the same way", () => {
    const streak = newConflictStreak();
    recordPollingError(streak, CONFLICT, 0);
    clearConflictStreak(streak);

    const log = recordPollingError(streak, CONFLICT, CONFLICT_HANDOVER_MS * 2);

    expect(log?.level).toBe("info");
    expect(streak.count).toBe(1);
  });
});
