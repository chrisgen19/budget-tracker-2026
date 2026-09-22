import { toLocalComponents } from "@/lib/schedule-matching";
import type { AssessmentAnomaly, AssessmentAnomalyKind } from "@/types";

/**
 * The daily Watchlist digest on Telegram: what needs doing, sent once, and only what is new.
 *
 * Pure, with no Prisma and no network, so every rule here is unit-tested. The cron route loads the
 * findings and the records of what was already sent, and hands them in.
 */

/**
 * Which Watchlist findings are worth a Telegram message: the ones that ask for an action.
 *
 * An exhaustive `Record`, the pattern `ANOMALY_SCOPE` uses, so a new finding kind does not compile
 * until somebody decides whether it interrupts the owner's day. The line is "something to do", not
 * "something interesting": a bill or card payment due or missed, interest nobody has logged, a
 * subscription about to renew, a deposit that has not arrived, cash projected to run short, a
 * budget limit reached. Observations about spending patterns stay in the app, where they are read
 * when someone goes looking -- pushed at them, they teach the owner to ignore the chat, and then
 * the missed bill is ignored along with them.
 */
export const DIGEST_KINDS: Record<AssessmentAnomalyKind, boolean> = {
  "missed-bill": true,
  "bill-due-soon": true,
  "card-payment-due-soon": true,
  "card-interest-untracked": true,
  "recurring-renews-soon": true,
  "missing-expected-income": true,
  "cash-shortfall": true,
  "budget-threshold": true,
  "budget-forecast": true,
  // Observations, or housekeeping with no deadline: in the app, not in the chat.
  "bill-snoozed": false,
  "bill-under-budgeted": false,
  "card-utilization-high": false,
  "card-minimum-only": false,
  "recurring-new": false,
  "recurring-ended": false,
  "recurring-amount-change": false,
  "category-spike": false,
  "new-category": false,
  "outlier-transaction": false,
  overspend: false,
  "savings-drop": false,
  pace: false,
  "missing-income": false,
  duplicate: false,
  "logging-gap": false,
  "low-coverage": false,
  "insufficient-history": false,
  "goal-off-pace": false,
  "goal-stalled": false,
};

/** Past this many lines the message says how many more, and the app has the rest. */
export const DIGEST_MAX_LINES = 10;

/**
 * Whether today's digest is due: at or past the chosen time, on **any** day.
 *
 * "At or past", not "inside a 15-minute window", for the evening prompt's reason: a cron tick
 * delayed by a deploy would otherwise drop the whole day. Once a day comes from the digest log's
 * unique index, not from this. Unlike the evening prompt it runs at weekends too -- a card falls
 * due on a Saturday as readily as on a Tuesday.
 */
export const isDigestDue = ({
  now,
  timezoneOffset,
  digestTime,
}: {
  now: Date;
  timezoneOffset: number;
  digestTime: string;
}): boolean => toLocalComponents(now, timezoneOffset).time >= digestTime;

export interface KeyedFinding {
  finding: AssessmentAnomaly;
  /** The SHA-256 of `watchlistFindingKey`, the identity both the app and this share. */
  hash: string;
}

/**
 * The findings today's digest should carry: the kinds above, less anything the owner resolved or
 * snoozed in the app, less anything already sent. Order is kept, and it arrives most urgent first.
 */
export const selectDigestFindings = (
  findings: readonly KeyedFinding[],
  suppressed: ReadonlySet<string>,
  alreadySent: ReadonlySet<string>
): KeyedFinding[] =>
  findings.filter(({ finding, hash }) => DIGEST_KINDS[finding.kind] && !suppressed.has(hash) && !alreadySent.has(hash));

/** Telegram's HTML mode needs only these three escaped, and a finding title carries user text. */
const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The message itself, as Telegram HTML, or null when there is nothing new -- a digest reading
 * "nothing today" every morning is exactly the noise that gets a chat muted.
 *
 * HTML rather than the Markdown the evening prompt uses, because titles carry names the user
 * typed: a card called `BDO_Gold` is a broken Markdown entity, and `sendMessage`'s plain-text
 * fallback then drops the button along with the formatting. Escaping three characters cannot fail.
 *
 * Titles only. Each finding's `title` names what and when, with no amounts; the figures and the
 * explanation live in the app, one tap away, where Hide Amounts applies.
 */
export const composeDigest = (findings: readonly KeyedFinding[]): string | null => {
  if (findings.length === 0) return null;
  const shown = findings.slice(0, DIGEST_MAX_LINES);
  const more = findings.length - shown.length;
  return [
    `\u{1F514} <b>Watchlist: ${findings.length} new</b>`,
    "",
    ...shown.map(({ finding }) => `\u2022 ${escapeHtml(finding.title)}`),
    ...(more > 0 ? ["", `\u2026and ${more} more in the app.`] : []),
  ].join("\n");
};

/** Where the button goes: the Watchlist tab, or nothing when no app URL is configured. */
export const watchlistLink = (baseUrl: string | null): string | null =>
  baseUrl ? `${baseUrl}/analytics?tab=watchlist` : null;
