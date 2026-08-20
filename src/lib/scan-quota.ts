import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** How long an in-flight PENDING reservation holds a credit before it is treated as
 *  abandoned. Longer than the worst-case Gemini path (3 attempts + fallback, each
 *  capped by GEMINI_TIMEOUT_MS) so a slow scan is never refunded out from under itself,
 *  short enough that a crashed request does not strand a credit for the rest of the month. */
const RESERVATION_TTL_MINUTES = 10;

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

/** Attempts in the rolling window, counting every outcome including refunded failures. */
const countRecentAttempts = (userId: string, now: Date) =>
  prisma.scanLog.count({
    where: {
      userId,
      createdAt: { gte: new Date(now.getTime() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000) },
    },
  });

/** Credits consumed this month: successes plus reservations still in flight. */
export const countScansUsed = (userId: string, monthStart: Date, now = new Date()) =>
  prisma.scanLog.count({
    where: {
      userId,
      createdAt: { gte: monthStart },
      OR: [
        { status: "SUCCESS" },
        {
          status: "PENDING",
          createdAt: { gt: new Date(now.getTime() - RESERVATION_TTL_MINUTES * 60 * 1000) },
        },
      ],
    },
  });

/**
 * Atomically claim one scan credit before calling Gemini.
 *
 * The insert and the limit check are a single statement, so concurrent requests cannot
 * both observe the same pre-insert count and overshoot the limit. The client itself makes
 * this reachable in normal use: multi-scan uploads run three requests in parallel.
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

  const recentAttempts = await countRecentAttempts(userId, now);
  if (recentAttempts >= RATE_LIMIT_MAX_ATTEMPTS) {
    return {
      ok: false,
      denial: { reason: "RATE_LIMITED", retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60 },
    };
  }

  const reservationId = randomUUID();
  const monthStart = monthStartForUser(timezoneOffset, now);

  // Unlimited plans still get a row, so rate limiting and usage reporting stay accurate.
  if (monthlyScanLimit <= 0) {
    await prisma.scanLog.create({ data: { id: reservationId, userId, status: "PENDING" } });
    return { ok: true, reservationId };
  }

  // A plain "count, compare, insert" cannot enforce this even inside one statement: under
  // READ COMMITTED every concurrent request reads the same pre-insert snapshot and they all
  // pass the check. The advisory lock serialises reservations per user so each one counts
  // rows the previous one already committed. It is transaction-scoped, so it always releases.
  const used = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

    const staleBefore = new Date(now.getTime() - RESERVATION_TTL_MINUTES * 60 * 1000);
    const consumed = await tx.scanLog.count({
      where: {
        userId,
        createdAt: { gte: monthStart },
        OR: [{ status: "SUCCESS" }, { status: "PENDING", createdAt: { gt: staleBefore } }],
      },
    });

    if (consumed >= monthlyScanLimit) return consumed;

    await tx.scanLog.create({ data: { id: reservationId, userId, status: "PENDING" } });
    return null;
  });

  if (used !== null) {
    return { ok: false, denial: { reason: "LIMIT_REACHED", used, limit: monthlyScanLimit } };
  }

  return { ok: true, reservationId };
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
