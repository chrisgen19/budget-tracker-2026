/**
 * The I/O half of the Watchlist digest: load the findings, decide with `watchlist-digest.ts`,
 * send, and record what went out. The cron route calls this once per tick for the bot's owner.
 */
import type { PrismaClient } from "@prisma/client";
import { collectAssessmentFacts } from "@/lib/assessment-facts-query";
import { formatPeriodLabel } from "@/lib/analytics-period";
import { userToday } from "@/lib/bill-dates";
import { formatLocalDate } from "@/lib/validations";
import { getSuppressingWatchlistStates, hashWatchlistFindingKey } from "@/lib/watchlist-finding-states";
import { watchlistFindingKey } from "@/lib/watchlist-findings";
import { appBaseUrl } from "@/lib/telegram/app-link";
import { sendMessage } from "@/lib/telegram/send";
import {
  composeDigest,
  isDigestDue,
  selectDigestFindings,
  watchlistLink,
  type KeyedFinding,
} from "@/lib/telegram/watchlist-digest";

export type DigestOutcome = "not-due" | "already-sent" | "nothing-new" | "sent";

export interface DigestUser {
  id: string;
  timezoneOffset: number | null;
  telegramWatchlistDigestTime: string;
}

/**
 * The user's current calendar month, which is what the Watchlist opens on.
 *
 * Monthly, and a whole calendar month, because that is the only period `collectAssessmentFacts`
 * reads budget findings for. It also makes a period-scoped finding's key the one the app computes
 * for the month on screen, so resolving it there silences it here.
 */
const currentMonth = (now: Date, tzOffset: number): { from: string; to: string } => {
  const today = formatLocalDate(now, tzOffset);
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const ym = today.slice(0, 7);
  return { from: `${ym}-01`, to: `${ym}-${String(lastDay).padStart(2, "0")}` };
};

/** Every current finding, keyed the way the Watchlist keys it, and the hashes the user silenced. */
const loadFindings = async (
  prisma: PrismaClient,
  userId: string,
  period: { from: string; to: string },
  now: Date
): Promise<{ keyed: KeyedFinding[]; suppressed: Set<string>; alreadySent: Set<string> }> => {
  const facts = await collectAssessmentFacts(prisma, userId, {
    ...period,
    granularity: "monthly",
    periodLabel: formatPeriodLabel("monthly", period.from, period.to),
  });
  const keys = facts.anomalies.map((finding) => watchlistFindingKey(finding, facts.period));
  const keyed = facts.anomalies.map((finding, i) => ({ finding, hash: hashWatchlistFindingKey(keys[i]) }));
  const states = await getSuppressingWatchlistStates(prisma, userId, keys, now);
  const sent = await prisma.telegramWatchlistAlert.findMany({
    where: { userId, findingHash: { in: keyed.map((k) => k.hash) } },
    select: { findingHash: true },
  });
  return {
    keyed,
    suppressed: new Set(Object.keys(states).map(hashWatchlistFindingKey)),
    alreadySent: new Set(sent.map((row) => row.findingHash)),
  };
};

/**
 * Sends today's digest if it is due and has something new in it.
 *
 * The day is claimed in `telegram_watchlist_digests` *before* anything is read or sent, and the
 * unique index decides it, so two overlapping ticks cannot both send. A failed send releases the
 * claim and throws, so the next tick retries; a quiet day keeps it, so a finding that appears in
 * the afternoon waits for tomorrow's digest rather than arriving as a second message today.
 *
 * What was sent is recorded by hash only after Telegram accepted it. A recording that fails after
 * a good send means those findings may repeat tomorrow, which is the recoverable direction: the
 * alternative order loses them for good.
 */
export const sendWatchlistDigest = async (
  prisma: PrismaClient,
  user: DigestUser,
  chatId: number,
  now: Date
): Promise<DigestOutcome> => {
  const tzOffset = user.timezoneOffset ?? 0;
  if (!isDigestDue({ now, timezoneOffset: tzOffset, digestTime: user.telegramWatchlistDigestTime })) {
    return "not-due";
  }

  const sentOn = userToday(tzOffset, now);
  const claimed = await prisma.telegramWatchlistDigest.createMany({
    data: [{ userId: user.id, sentOn }],
    skipDuplicates: true,
  });
  if (claimed.count === 0) return "already-sent";

  let fresh: KeyedFinding[];
  try {
    const { keyed, suppressed, alreadySent } = await loadFindings(prisma, user.id, currentMonth(now, tzOffset), now);
    fresh = selectDigestFindings(keyed, suppressed, alreadySent);
    const text = composeDigest(fresh);
    if (!text) return "nothing-new";

    const link = watchlistLink(appBaseUrl(process.env));
    const keyboard = link ? { inline_keyboard: [[{ text: "Open Watchlist", url: link }]] } : undefined;
    // `sendMessage` reports failure as null rather than throwing; see the evening prompt.
    if ((await sendMessage(chatId, text, "HTML", keyboard)) === null) {
      throw new Error("Telegram would not accept the Watchlist digest");
    }
  } catch (error) {
    await prisma.telegramWatchlistDigest.deleteMany({ where: { userId: user.id, sentOn } });
    throw error;
  }

  // Outside the try on purpose: the message is out, so the day stays claimed whatever happens here.
  await prisma.telegramWatchlistAlert.createMany({
    data: fresh.map(({ hash }) => ({ userId: user.id, findingHash: hash })),
    skipDuplicates: true,
  });
  return "sent";
};
