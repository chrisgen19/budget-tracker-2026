/**
 * Pure prose rules used by `verify-ai-assessment.ts` to judge a generated report.
 *
 * Deliberately import-safe: it constructs no Prisma client and runs nothing at
 * module scope, so a test may import it without opening a database connection.
 * The CLI entry point that uses it self-executes and is never imported, which is
 * the same split `bill-matching.ts` and `database-url.ts` already follow.
 *
 * These two are the load-bearing assertions of that script, and both were once
 * written in a form that could not fail. They earn a test of their own for the
 * same reason the script exists at all: a check nobody can see failing is
 * indistinguishable from a check that passes.
 */

const CURRENCY_CODE = "PHP|USD|EUR|GBP|AUD|CAD|SGD|INR|JPY";

/**
 * A raw currency amount in prose, which the assessment promises never to write.
 *
 * Four shapes, because the model is handed bare numbers in the data snapshot and
 * told the currency separately -- so the likeliest leak carries no symbol at all.
 * Matching only a leading `₱` passed "electricity hit 14,126 in May" and "about
 * 1,500 PHP" clean, which are the two forms this actually takes.
 *
 * A bare number counts as money when it carries a thousands separator or runs to
 * four-plus digits. That spares percentages, counts and day figures, and it
 * spares years: "2026" is not a peso amount, and flagging it would train a reader
 * to ignore the check, which is worse than having no check.
 */
export const CURRENCY_IN_PROSE = new RegExp(
  [
    // ₱1,200 / PHP 500
    `(?:[₱$€£¥]|\\b(?:${CURRENCY_CODE}))\\s?\\d[\\d,]*(?:\\.\\d+)?`,
    // 1,500 PHP / 1500 pesos
    `\\d[\\d,]*(?:\\.\\d+)?\\s?(?:${CURRENCY_CODE}|pesos?)\\b`,
    // 14,126 -- a separated figure is never a count or a percentage
    `\\b\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?\\b(?!\\s?%)`,
    // 14126 -- four-plus digits, but not a year
    `\\b(?!(?:19|20)\\d{2}\\b)\\d{4,}(?:\\.\\d+)?\\b(?!\\s?%)`,
  ].join("|"),
  "i",
);

/**
 * The window `/api/analytics` would compare a given period against.
 *
 * Derived from `from`/`to`, never from today. Deriving it from the clock meant
 * `FROM=2026-08-01 TO=2026-08-31` run in September compared August against
 * itself: `previousSummary` came back byte-identical to `summary`, and the model
 * was told income and expenses had not moved while the facts digest showed real
 * movement -- a payload production cannot produce.
 *
 * Mirrors `analytics/route.ts`: a full calendar month shifts back one calendar
 * month, anything else shifts back by its own length.
 */
export const previousPeriod = (from: string, to: string): { from: string; to: string; label: string } => {
  const [fY, fM, fD] = from.split("-").map(Number);
  const [tY, tM, tD] = to.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");

  const lastDayOfFromMonth = new Date(Date.UTC(fY, fM, 0)).getUTCDate();
  if (fD === 1 && fY === tY && fM === tM && tD === lastDayOfFromMonth) {
    const pm = fM === 1 ? 12 : fM - 1;
    const py = fM === 1 ? fY - 1 : fY;
    const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay)}`, label: `${py}-${pad(pm)}` };
  }

  const start = Date.UTC(fY, fM - 1, fD);
  const span = Date.UTC(tY, tM - 1, tD) - start + 86_400_000;
  const key = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const prevTo = new Date(start - 86_400_000);
  const prevFrom = new Date(start - span);
  return { from: key(prevFrom), to: key(prevTo), label: `${key(prevFrom)} – ${key(prevTo)}` };
};
