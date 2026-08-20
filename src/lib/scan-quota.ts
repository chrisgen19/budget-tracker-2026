import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GEMINI_WORST_CASE_MS } from "@/lib/gemini-limits";

/** Floor and ceiling for the reservation TTL. The ceiling applies when Gemini calls are
 *  untimed (GEMINI_TIMEOUT_MS=0), where there is no worst case to derive one from. */
const RESERVATION_TTL_FLOOR_MS = 10 * 60 * 1000;
const RESERVATION_TTL_CEILING_MS = 60 * 60 * 1000;

/** How long an in-flight PENDING reservation holds a credit before it is treated as abandoned.
 *
 *  Derived from the Gemini retry policy rather than fixed, with 2x headroom: a request that is
 *  still legitimately running must never have its reservation expire, or another request could
 *  take the last credit and the original would then settle SUCCESS over the limit. A fixed
 *  10 minutes was safe on default settings (worst case is ~5m04s) but not if GEMINI_TIMEOUT_MS
 *  is raised or disabled. */
export const RESERVATION_TTL_MS = Math.min(
  RESERVATION_TTL_CEILING_MS,
  Math.max(
    RESERVATION_TTL_FLOOR_MS,
    GEMINI_WORST_CASE_MS === null ? RESERVATION_TTL_CEILING_MS : GEMINI_WORST_CASE_MS * 2,
  ),
);

/** Bounds on how long a reservation may wait for the per-user advisory lock. Prisma defaults
 *  (2s wait / 5s duration) are tight for a burst of concurrent uploads all serialising on the
 *  same user, and exceeding them throws instead of returning a clean quota denial. */
const RESERVATION_TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

/** Rolling-window rate limit on scan *attempts*, regardless of outcome.
 *  Because failures are refunded, the monthly limit no longer bounds Gemini spend on its
 *  own — this window is what caps it. Sized well above real usage: a 50-image upload plus
 *  itemisation of every one of them stays under it. */
const RATE_LIMIT_WINDOW_MINUTES = 15;
const RATE_LIMIT_MAX_ATTEMPTS = 120;

export type ScanQuotaDenial =
  | { reason: "LIMIT_REACHED"; used: number; limit: number }
  | { reason: "RATE_LIMITED"; retryAfterSeconds: number };

export type ScanReservation =
  | { ok: true; reservationId: string }
  | { ok: false; denial: ScanQuotaDenial };

/**
 * Start of the current month in the user's own calendar, returned as a UTC instant.
 *
 * Without the offset the quota window follows the container clock (UTC in production),
 * so an Asia/Manila user's allowance resets at 08:00 local on the 1st rather than midnight.
 *
 * @param timezoneOffset Minutes from `Date.getTimezoneOffset()` (e.g. -480 for UTC+8).
 */
export const monthStartForUser = (timezoneOffset: number, now = new Date()): Date => {
  const tzMs = timezoneOffset * 60 * 1000;
  const local = new Date(now.getTime() - tzMs);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + tzMs);
};

/** Credits consumed this month: successes plus reservations still in flight. */
export const countScansUsed = (userId: string, monthStart: Date, now = new Date()) =>
  prisma.scanLog.count({
    where: consumedCreditsWhere(userId, monthStart, now),
  });

/** Credits that count against the monthly limit: successes, plus reservations still live. */
const consumedCreditsWhere = (userId: string, monthStart: Date, now: Date) => ({
  userId,
  createdAt: { gte: monthStart },
  OR: [
    { status: "SUCCESS" as const },
    {
      status: "PENDING" as const,
      createdAt: { gt: new Date(now.getTime() - RESERVATION_TTL_MS) },
    },
  ],
});

/**
 * Atomically claim one scan credit before calling Gemini.
 *
 * Both the rate limit and the monthly limit are checked under a per-user advisory lock,
 * in the same transaction as the insert. Neither check can be done outside it: under
 * READ COMMITTED, concurrent requests all read the same pre-insert snapshot and all pass.
 * The client makes this reachable in ordinary use, not just under attack, since multi-scan
 * uploads run three requests in parallel.
 *
 * The lock is taken for every plan including unlimited ones. Unlimited plans skip only the
 * monthly check, never the rate limit, which is the sole ceiling on Gemini spend once
 * failed scans are refunded.
 *
 * A reservation must always be settled by `settleScanReservation`.
 *
 * @param monthlyScanLimit 0 means unlimited, matching AppSettings semantics.
 */
export async function reserveScanCredit(
  userId: string,
  monthlyScanLimit: number,
  timezoneOffset: number,
): Promise<ScanReservation> {
  const now = new Date();
  const reservationId = randomUUID();
  const monthStart = monthStartForUser(timezoneOffset, now);
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);

  const denial = await prisma.$transaction(async (tx): Promise<ScanQuotaDenial | null> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

    // Every attempt counts here regardless of outcome, so refunded failures still throttle.
    const recentAttempts = await tx.scanLog.count({
      where: { userId, createdAt: { gte: windowStart } },
    });
    if (recentAttempts >= RATE_LIMIT_MAX_ATTEMPTS) {
      return { reason: "RATE_LIMITED", retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60 };
    }

    if (monthlyScanLimit > 0) {
      const used = await tx.scanLog.count({
        where: consumedCreditsWhere(userId, monthStart, now),
      });
      if (used >= monthlyScanLimit) {
        return { reason: "LIMIT_REACHED", used, limit: monthlyScanLimit };
      }
    }

    // Unlimited plans still get a row, so rate limiting and usage reporting stay accurate.
    await tx.scanLog.create({ data: { id: reservationId, userId, status: "PENDING" } });
    return null;
  }, RESERVATION_TX_OPTIONS);

  return denial ? { ok: false, denial } : { ok: true, reservationId };
}

/**
 * Close out a reservation.
 *
 * `SUCCESS` keeps the credit spent. `FAILED` refunds it: we deliberately absorb the cost
 * of every failed scan rather than charging the user, including unreadable images and
 * non-receipts. The row is updated rather than deleted so the attempt still counts toward
 * the rate limit and remains visible for debugging.
 *
 * Never throws — a settle failure must not turn a completed scan into a 500.
 */
export async function settleScanReservation(
  reservationId: string,
  outcome: "SUCCESS" | "FAILED",
): Promise<void> {
  try {
    await prisma.scanLog.update({
      where: { id: reservationId },
      data: { status: outcome },
    });
  } catch (error) {
    // P2025 = row already gone (user deleted mid-scan); nothing to settle.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return;
    console.error("[scan-quota] Failed to settle reservation:", error);
  }
}
