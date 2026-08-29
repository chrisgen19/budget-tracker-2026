import { describe, expect, it, vi } from "vitest";
import {
  newShutdownState,
  requestShutdown,
  shouldStop,
  type ShutdownState,
} from "@/lib/telegram/shutdown";

/**
 * The two cases pull in opposite directions, which is the whole design.
 *
 * An idle loop is parked in a 20-second long poll and Docker's default grace period is 10, so
 * waiting for that poll is waiting too long — it has to be interrupted. A busy loop is mid-handler
 * and must be allowed to finish, because abandoning it is precisely what causes the double scan
 * this exists to prevent.
 */
describe("requestShutdown", () => {
  it("interrupts an idle poll, which would otherwise outlast the grace period", () => {
    const abortIdlePoll = vi.fn();
    const state: ShutdownState = { ...newShutdownState(), abortIdlePoll };

    expect(requestShutdown(state)).toBe("aborted_idle_poll");
    expect(abortIdlePoll).toHaveBeenCalledOnce();
    expect(shouldStop(state)).toBe(true);
  });

  it("never interrupts a handler in flight", () => {
    // Killing a handler mid-way is the bug: the batch is left unconfirmed, the replacement
    // container replays it, and scan_receipt is not idempotent, so the receipt is charged twice.
    const abortIdlePoll = vi.fn();
    const state: ShutdownState = { requested: false, handling: true, abortIdlePoll };

    expect(requestShutdown(state)).toBe("awaiting_handler");
    expect(abortIdlePoll).not.toHaveBeenCalled();
    // Still flagged, so the loop stops at the next boundary between updates.
    expect(shouldStop(state)).toBe(true);
  });

  it("flags the stop even with no poll to abort", () => {
    // Between the poll returning and the next one starting there is nothing to cancel.
    const state = newShutdownState();
    expect(requestShutdown(state)).toBe("awaiting_handler");
    expect(shouldStop(state)).toBe(true);
  });

  it("is idempotent, since SIGTERM can arrive more than once", () => {
    const abortIdlePoll = vi.fn();
    const state: ShutdownState = { ...newShutdownState(), abortIdlePoll };

    requestShutdown(state);
    requestShutdown(state);

    expect(abortIdlePoll).toHaveBeenCalledTimes(2);
    expect(shouldStop(state)).toBe(true);
  });

  it("does not stop a loop nobody asked to stop", () => {
    expect(shouldStop(newShutdownState())).toBe(false);
  });
});
