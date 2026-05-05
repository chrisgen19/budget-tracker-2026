import { validDateString } from "@/lib/validations";

/** Parse a YYYY-MM-DD string with calendar validation. Returns the input on success, fallback otherwise. */
export const parseLocalDate = (raw: FormDataEntryValue | null, fallback: string): string => {
  if (typeof raw !== "string") return fallback;
  return validDateString.safeParse(raw).success ? raw : fallback;
};

/** Normalize a receipt date returned by Gemini and flag when the year differs from today.
 *  Uses photoFallback (the photo's capture date) only when parsing fails — preserving
 *  legitimate cross-year OCR dates (e.g. a 2025 receipt scanned in early 2026).
 *  When the year is suspicious, the OCR date is kept and dateWarning is raised so the UI
 *  can prompt the user to confirm or correct it. */
export const checkReceiptDate = (
  dateStr: string,
  todayStr: string,
  photoFallback: string,
): { date: string; dateWarning: boolean } => {
  const dateOnly = dateStr.slice(0, 10); // normalize "2024-03-14T13:45" → "2024-03-14"
  const parsed = new Date(dateOnly + "T00:00:00");
  if (isNaN(parsed.getTime())) return { date: photoFallback, dateWarning: false };
  const todayYear = new Date(todayStr + "T00:00:00").getFullYear();
  return { date: dateOnly, dateWarning: parsed.getFullYear() !== todayYear };
};
