/** A reporting question, once the classifier's output has been checked. */
export type ReportIntent =
  | { kind: "TRENDS"; month: string | null }
  | { kind: "MONTHLY"; months: number }
  | { kind: "TOP_EXPENSES"; month: string | null }
  | { kind: "LABEL_BREAKDOWN"; month: string | null }
  | { kind: "RECEIPT_ITEMS"; search: string | null; month: string | null }
  | null;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What "the last few months" means when the user did not say, and the ceiling on what they can ask
 *  for. Twenty-four keeps the reply readable and the query bounded. */
const DEFAULT_MONTHS = 6;
const MAX_MONTHS = 24;

const validMonth = (value: unknown): string | null =>
  typeof value === "string" && MONTH.test(value) ? value : null;

/**
 * Read a reporting intent out of the classifier's reply, or return null to let it fall through.
 *
 * Every value is validated rather than trusted, for the reason that recurs throughout this bot: a
 * filter the query cannot satisfy does not fail loudly, it returns an empty or wrong-period
 * result that reads exactly like a real answer. A month of "August" would report on the current
 * month while the user believes they asked about a past one.
 *
 * An unusable month is dropped rather than guessed at, which leaves each handler on its own
 * default: the current month, or no month filter at all. Wider or more recent than asked, never
 * silently the wrong period.
 */
export const parseReportIntent = (result: unknown): ReportIntent => {
  if (!result || typeof result !== "object") return null;

  const { action, month, months, search } = result as Record<string, unknown>;

  switch (action) {
    case "SHOW_TRENDS":
      return { kind: "TRENDS", month: validMonth(month) };

    case "SHOW_MONTHLY": {
      // Rounded and clamped rather than rejected: "the last few months" is a vague question and
      // answering it over six is better than refusing because the model said 5.5 or 100.
      const asked = typeof months === "number" && Number.isFinite(months) ? Math.round(months) : NaN;
      const count = Number.isNaN(asked) ? DEFAULT_MONTHS : Math.min(MAX_MONTHS, Math.max(1, asked));
      return { kind: "MONTHLY", months: count };
    }

    case "SHOW_TOP_EXPENSES":
      return { kind: "TOP_EXPENSES", month: validMonth(month) };

    case "SHOW_LABEL_BREAKDOWN":
      return { kind: "LABEL_BREAKDOWN", month: validMonth(month) };

    case "SHOW_RECEIPT_ITEMS": {
      const term = typeof search === "string" ? search.trim() : "";
      return { kind: "RECEIPT_ITEMS", search: term || null, month: validMonth(month) };
    }

    default:
      return null;
  }
};
