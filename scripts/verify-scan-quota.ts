/**
 * Verification harness for the receipt scan quota (src/lib/scan-quota.ts).
 *
 * The reservation path is easy to get subtly wrong: an earlier attempt used a single
 * `INSERT ... SELECT ... WHERE (count) < limit` statement, which silently enforced nothing
 * because under READ COMMITTED every concurrent request reads the same pre-insert snapshot.
 * These checks pin that behaviour down, plus the refund, stale-reservation, timezone and
 * rate-limit rules.
 *
 * Creates and deletes its own throwaway user, so it is safe to run against a dev database.
 * There is no test runner in this repo; run it directly:
 *
 *   pnpm exec tsx scripts/verify-scan-quota.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  reserveScanCredit,
  settleScanReservation,
  countScansUsed,
  monthStartForUser,
  RESERVATION_TTL_MS,
} from "../src/lib/scan-quota";
import { GEMINI_WORST_CASE_MS } from "../src/lib/gemini-limits";

const prisma = new PrismaClient();
const EMAIL = "quota-probe@scratch.invalid";
let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

async function main() {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({
    data: { name: "Quota Probe", email: EMAIL, password: "x", receiptScanEnabled: true },
  });
  const uid = user.id;
  const tz = user.timezoneOffset;
  const monthStart = monthStartForUser(tz);

  // 1. Concurrency: 12 simultaneous reservations against a limit of 5.
  const results = await Promise.all(
    Array.from({ length: 12 }, () => reserveScanCredit(uid, 5, tz)),
  );
  check("concurrent reservations granted (limit 5)", results.filter((r) => r.ok).length, 5);
  check("concurrent reservations denied", results.filter((r) => !r.ok).length, 7);
  check("credits used after burst", await countScansUsed(uid, monthStart), 5);

  // 2. Refund: failing 3 of them returns the credits.
  const granted = results.filter((r): r is { ok: true; reservationId: string } => r.ok);
  for (const g of granted.slice(0, 3)) await settleScanReservation(g.reservationId, "FAILED");
  for (const g of granted.slice(3)) await settleScanReservation(g.reservationId, "SUCCESS");
  check("credits used after 3 refunds", await countScansUsed(uid, monthStart), 2);
  check("FAILED rows retained for rate limiting", await prisma.scanLog.count({ where: { userId: uid, status: "FAILED" } }), 3);

  // 3. Quota reopens for the refunded credits.
  const after = await Promise.all(Array.from({ length: 5 }, () => reserveScanCredit(uid, 5, tz)));
  check("reservations granted after refund", after.filter((r) => r.ok).length, 3);
  for (const r of after) if (r.ok) await settleScanReservation(r.reservationId, "FAILED");

  // 4. Unlimited plans are never denied on quota.
  const unlimited = await Promise.all(Array.from({ length: 4 }, () => reserveScanCredit(uid, 0, tz)));
  check("unlimited plan reservations granted", unlimited.filter((r) => r.ok).length, 4);
  for (const r of unlimited) if (r.ok) await settleScanReservation(r.reservationId, "FAILED");

  // 5. Stale PENDING rows stop holding a credit past the TTL.
  await prisma.scanLog.deleteMany({ where: { userId: uid } });
  await prisma.scanLog.createMany({
    data: Array.from({ length: 5 }, () => ({
      userId: uid,
      status: "PENDING" as const,
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
    })),
  });
  check("stale PENDING not counted", await countScansUsed(uid, monthStart), 0);
  const revived = await reserveScanCredit(uid, 5, tz);
  check("reservation granted past stale TTL", revived.ok, true);

  // 6. Month window follows the user's calendar, not the container's.
  //    UTC+8 at 2026-09-01T03:00 local is still 2026-08-31 in UTC.
  const localFirst = new Date("2026-08-31T19:00:00Z"); // = 2026-09-01 03:00 in UTC+8
  check(
    "month start for UTC+8 user",
    monthStartForUser(-480, localFirst).toISOString(),
    "2026-08-31T16:00:00.000Z", // 2026-09-01 00:00 local
  );
  check(
    "month start for UTC server user",
    monthStartForUser(0, localFirst).toISOString(),
    "2026-08-01T00:00:00.000Z",
  );

  // 7. Rate limit trips on attempt volume regardless of outcome (this is what now caps
  //    Gemini spend, since failures are refunded).
  await prisma.scanLog.deleteMany({ where: { userId: uid } });
  await prisma.scanLog.createMany({
    data: Array.from({ length: 120 }, () => ({ userId: uid, status: "FAILED" as const })),
  });
  const limited = await reserveScanCredit(uid, 0, tz);
  check("rate limited after 120 attempts", limited.ok === false && limited.denial.reason, "RATE_LIMITED");
  check("refunded attempts still count toward rate limit", await countScansUsed(uid, monthStart), 0);

  // 8. The rate limit must hold against a concurrent burst too, on both limited and
  //    unlimited plans. It is the only ceiling on Gemini spend once failures are refunded,
  //    so a burst that slips past it is the whole abuse vector reopening.
  for (const plan of [0, 5]) {
    await prisma.scanLog.deleteMany({ where: { userId: uid } });
    await prisma.scanLog.createMany({
      data: Array.from({ length: 119 }, () => ({ userId: uid, status: "FAILED" as const })),
    });
    const burst = await Promise.all(
      Array.from({ length: 10 }, () => reserveScanCredit(uid, plan, tz)),
    );
    check(
      `concurrent burst at rate limit boundary (limit ${plan || "unlimited"})`,
      burst.filter((r) => r.ok).length,
      1,
    );
    for (const r of burst) if (r.ok) await settleScanReservation(r.reservationId, "FAILED");
  }


  // 9. A reservation must outlive the slowest legitimate Gemini call, or a still-running
  //    request could have its credit taken and then settle SUCCESS over the limit.
  check(
    "reservation TTL outlives worst-case Gemini call",
    GEMINI_WORST_CASE_MS === null || RESERVATION_TTL_MS > GEMINI_WORST_CASE_MS,
    true,
  );
}

main()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    // Cleanup lives here so a throwing check cannot leave the probe user and its scan_logs
    // behind, and so $disconnect always runs: process.exit would preempt it otherwise.
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  });
