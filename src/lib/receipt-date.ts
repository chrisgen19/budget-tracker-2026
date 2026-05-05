import { validDateString } from "@/lib/validations";

/** Parse a YYYY-MM-DD string with calendar validation. Returns the input on success, fallback otherwise. */
export const parseLocalDate = (raw: FormDataEntryValue | null, fallback: string): string => {
  if (typeof raw !== "string") return fallback;
  return validDateString.safeParse(raw).success ? raw : fallback;
};

/** Normalize a receipt date returned by Gemini and flag when the year differs from today.
 *  Uses photoFallback (the photo's capture date) when Gemini's date is unparseable
 *  or when the parsed year differs from today — preserving the warning flag for the UI. */
export const checkReceiptDate = (
  dateStr: string,
  todayStr: string,
  photoFallback: string,
): { date: string; dateWarning: boolean } => {
  const dateOnly = dateStr.slice(0, 10); // normalize "2024-03-14T13:45" → "2024-03-14"
  const parsed = new Date(dateOnly + "T00:00:00");
  if (isNaN(parsed.getTime())) return { date: photoFallback, dateWarning: false };
  const todayYear = new Date(todayStr + "T00:00:00").getFullYear();
  if (parsed.getFullYear() !== todayYear) {
    return { date: photoFallback, dateWarning: true };
  }
  return { date: dateOnly, dateWarning: false };
};
