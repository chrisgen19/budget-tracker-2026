import { validDateString } from "@/lib/validations";

/** Parse a YYYY-MM-DD string with calendar validation. Returns the input on success, fallback otherwise. */
export const parseLocalDate = (raw: FormDataEntryValue | null, fallback: string): string => {
  if (typeof raw !== "string") return fallback;
  return validDateString.safeParse(raw).success ? raw : fallback;
};

export interface ReceiptDateCheck {
  date: string;
  /** The date is worth confirming: the year disagrees with today's, or was repaired below. */
  dateWarning: boolean;
  usedPhotoFallback: boolean;
  /** The year actually printed on the receipt, when `date` no longer carries it. Present only on
   *  a repair, so the UI can name what changed instead of showing a bare "check year". */
  repairedFromYear?: string;
}

/**
 * Whether a YYYY-MM-DD string names a real calendar day.
 *
 * `new Date("2026-02-31T00:00:00")` does not fail — it rolls over to 3 March — so a date that
 * cannot exist was being accepted and passed on verbatim, to be rolled over later by whatever
 * finally parsed it. Comparing the parsed components back against the string is what catches it;
 * `isNaN` alone only rejects the shapes JS refuses outright, like month 13.
 */
const isRealCalendarDate = (dateOnly: string, parsed: Date): boolean => {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return (
    parsed.getFullYear() === year && parsed.getMonth() + 1 === month && parsed.getDate() === day
  );
};

/**
 * Whether an OCR date is the photo's own date with only the year misread.
 *
 * Observed in production: a receipt printing `08/26/2026` came back as `2023-08-26` — month and
 * day exactly right, year three off. That signature is a digit misread, not a three-year-old
 * receipt, because reading a *different* date wrong almost never lands on the photo's month and
 * day by accident.
 *
 * Anchored to the photo rather than to today, because the photo is what bounds when the purchase
 * happened: a receipt cannot be photographed before it exists. That also makes the check work on
 * a receipt photographed days before it was uploaded.
 *
 * Deliberately narrow. Anything looser — "within a few days", "same month" — would start
 * rewriting dates that were read correctly.
 */
const isYearSlip = (dateOnly: string, photoDate: string): boolean =>
  dateOnly.slice(5) === photoDate.slice(5) && dateOnly.slice(0, 4) !== photoDate.slice(0, 4);

/**
 * Normalize a receipt date returned by Gemini and decide whether it needs confirming.
 *
 * `photoFallback` (the photo's capture date) is used outright when the date will not parse. It is
 * also used to repair a year slip — the one case where a *readable* date is overridden, which is
 * a deliberate narrowing of the "photo date only when unreadable" rule in AGENTS.md. A repair
 * always raises `dateWarning` and reports `repairedFromYear`, so the inference is shown to the
 * user rather than made behind their back: they can see the receipt and this code cannot.
 *
 * A cross-year date that is *not* a slip is preserved and merely flagged — scanning a December
 * receipt in January is legitimate, and silently rewriting it would be a data error rather than a
 * visible one.
 */
export const checkReceiptDate = (
  dateStr: string,
  todayStr: string,
  photoFallback: string,
): ReceiptDateCheck => {
  const dateOnly = dateStr.slice(0, 10); // normalize "2024-03-14T13:45" → "2024-03-14"
  const parsed = new Date(dateOnly + "T00:00:00");
  if (isNaN(parsed.getTime()) || !isRealCalendarDate(dateOnly, parsed)) {
    return { date: photoFallback, dateWarning: false, usedPhotoFallback: true };
  }

  const todayYear = new Date(todayStr + "T00:00:00").getFullYear();

  // Checked before any same-year shortcut: a receipt dated in the current year can still be wrong
  // when the photo is not, and that case — the receipt postdating its own photo — is impossible
  // rather than merely suspicious.
  if (isYearSlip(dateOnly, photoFallback)) {
    return {
      date: `${photoFallback.slice(0, 4)}-${dateOnly.slice(5)}`,
      dateWarning: true,
      usedPhotoFallback: false,
      repairedFromYear: dateOnly.slice(0, 4),
    };
  }

  return {
    date: dateOnly,
    dateWarning: parsed.getFullYear() !== todayYear,
    usedPhotoFallback: false,
  };
};
