/**
 * The decisions behind the evening prompt, kept away from the I/O that acts on them.
 *
 * The cron route owns Prisma and the Telegram call; everything that can be got wrong about
 * *when* to ask and *what* to ask lives here, where it can be tested without either.
 */
import { toLocalComponents } from "@/lib/schedule-matching";

/** Monday through Friday, in `getUTCDay()` numbering. */
const WEEKDAYS = new Set([1, 2, 3, 4, 5]);

export interface PromptDueInput {
  /** The instant the cron fired. */
  now: Date;
  /** `getTimezoneOffset()` convention, so UTC+8 is -480. */
  timezoneOffset: number;
  /** "HH:mm", zero-padded, in the user's own timezone. */
  promptTime: string;
}

/**
 * Whether this user's prompt is due, in their own calendar and clock.
 *
 * Deliberately "at or past the time", not "inside a 15-minute window". The cron fires every 15
 * minutes, and a window means a tick delayed by a slow run, a container restart or a deploy
 * silently drops that whole day - the one failure nobody notices, because a prompt that never
 * arrives looks exactly like a day with nothing to report. Being late is recoverable; being
 * skipped is not. The once-a-day guarantee comes from the log table's unique constraint, not
 * from the narrowness of this test.
 *
 * The comparison is lexicographic on "HH:mm", the same idiom `getScheduledLabelId` uses, which
 * is why the stored value must be zero-padded: "8:00" sorts after "20:00".
 */
export const isPromptDue = ({ now, timezoneOffset, promptTime }: PromptDueInput): boolean => {
  const { day, time } = toLocalComponents(now, timezoneOffset);
  if (!WEEKDAYS.has(day)) return false;
  return time >= promptTime;
};

export interface PromptContentInput {
  /** Whether a Transportation expense already exists in the user's local day. */
  hasFare: boolean;
  /** Whether a Food & Dining expense already exists in the user's local day. */
  hasLunch: boolean;
}

/**
 * What to ask, or null when there is nothing worth asking.
 *
 * Silence is a real answer here. A prompt that arrives after everything is already logged trains
 * the reader to ignore it, and an ignored prompt is worth less than none: the whole mechanism
 * depends on the message meaning "something is missing".
 *
 * The example answers the question with both halves in one message, which is what the question
 * invites. That only became honest advice once the shorthand path could actually split it: it
 * used to take the first amount and swallow the rest of the line, logging one wrong row and
 * reporting success (#204).
 */
export const composePrompt = ({ hasFare, hasLunch }: PromptContentInput): string | null => {
  if (hasFare && hasLunch) return null;

  const asking = !hasFare && !hasLunch
    ? "Fare today? Lunch?"
    : !hasFare
      ? "Any fare today?"
      : "Anything for lunch?";

  return (
    `\u{1F319} *Evening.* ${asking}\n\n` +
    `Tap a fare below, or just type it: \`250 grab, 180 lunch\`.`
  );
};
