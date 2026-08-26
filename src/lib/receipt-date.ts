import { validDateString } from "@/lib/validations";

/** Parse a YYYY-MM-DD string with calendar validation. Returns the input on success, fallback otherwise. */
export const parseLocalDate = (raw: FormDataEntryValue | null, fallback: string): string => {
  if (typeof raw !== "string") return fallback;
  return validDateString.safeParse(raw).success ? raw : fallback;
};

/**
 * Normalize a receipt date returned by Gemini and flag when the year differs from today.
 *
 * Uses photoFallback (the photo's capture date) only when parsing fails — preserving legitimate
 * cross-year OCR dates (e.g. a 2025 receipt scanned in early 2026). When the year is suspicious,
 * dateWarning is raised so the UI can prompt the user to confirm or correct it.
 *
 * One suspicious year is corrected rather than merely flagged: see `isYearSlip`.
 */
export const checkReceiptDate = (
  dateStr: string,
  todayStr: string,
  photoFallback: string,
): { date: string; dateWarning: boolean; usedPhotoFallback: boolean } => {
  const dateOnly = dateStr.slice(0, 10); // normalize "2024-03-14T13:45" → "2024-03-14"
  const parsed = new Date(dateOnly + "T00:00:00");
  if (isNaN(parsed.getTime())) {
    return { date: photoFallback, dateWarning: false, usedPhotoFallback: true };
  }
  const todayYear = new Date(todayStr + "T00:00:00").getFullYear();
  if (parsed.getFullYear() === todayYear) {
    return { date: dateOnly, dateWarning: false, usedPhotoFallback: false };
  }

  // The year disagrees with today's. Repair it when it looks like a misread rather than a real
  // date, but keep the warning either way — the correction is an inference, and the user is the
  // one who can see the receipt.
  return {
    date: isYearSlip(dateOnly, photoFallback) ? withYearOf(dateOnly, photoFallback) : dateOnly,
    dateWarning: true,
    usedPhotoFallback: false,
  };
};

/**
 * Whether an OCR date is the photo's own date with only the year misread.
 *
 * Observed in production: a receipt printed `08/26/2026` came back as `2023-08-26` — month and
 * day exactly right, year three off. That signature is a digit misread, not a three-year-old
 * receipt, because reading a *different* date wrong almost never lands on today's month and day
 * by accident.
 *
 * The false positive is a receipt genuinely from this same calendar day in an earlier year, which
 * needs a 1-in-365 coincidence *and* a year-old receipt being scanned. It costs nothing when it
 * happens: `dateWarning` stays on, so the UI still asks the user to check the year, exactly as it
 * would have without the correction.
 *
 * Deliberately narrow. Anything looser — "within a few days", "same month" — would start rewriting
 * dates that were read correctly, and a wrong date the user was never warned about is worse than
 * a right one they were.
 */
const isYearSlip = (dateOnly: string, photoDate: string): boolean =>
  dateOnly.slice(5) === photoDate.slice(5) && dateOnly.slice(0, 4) !== photoDate.slice(0, 4);

/** Replace a YYYY-MM-DD string's year with another's, keeping month and day. */
const withYearOf = (dateOnly: string, source: string): string =>
  `${source.slice(0, 4)}-${dateOnly.slice(5)}`;
