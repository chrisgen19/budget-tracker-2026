import { describe, expect, it } from "vitest";
import { checkReceiptDate } from "./receipt-date";

/** The photo was taken 2026-08-26; "today" is the same day, as it is for a live scan. */
const TODAY = "2026-08-26";
const PHOTO = "2026-08-26";

describe("checkReceiptDate", () => {
  it("keeps a date read correctly, with no warning", () => {
    expect(checkReceiptDate("2026-08-26", TODAY, PHOTO)).toEqual({
      date: "2026-08-26",
      dateWarning: false,
      usedPhotoFallback: false,
    });
  });

  it("drops a time component", () => {
    expect(checkReceiptDate("2026-08-26T13:45", TODAY, PHOTO).date).toBe("2026-08-26");
  });

  it("falls back to the photo's date when the string will not parse", () => {
    expect(checkReceiptDate("not a date", TODAY, PHOTO)).toEqual({
      date: PHOTO,
      dateWarning: false,
      usedPhotoFallback: true,
    });
  });

  // `new Date("2026-02-31T00:00:00")` does not fail — it rolls over to 3 March — so an
  // impossible date was accepted and returned verbatim, to be rolled over later by whatever
  // finally parsed it. isNaN alone only catches the shapes JS refuses outright, like month 13.
  it("rejects a date that rolls over rather than passing it on", () => {
    const result = checkReceiptDate("2026-02-31", TODAY, PHOTO);
    expect(result.usedPhotoFallback).toBe(true);
    expect(result.date).toBe(PHOTO);
  });

  it("rejects a date JS refuses outright", () => {
    const result = checkReceiptDate("2026-13-40", TODAY, PHOTO);
    expect(result.usedPhotoFallback).toBe(true);
    expect(result.date).toBe(PHOTO);
  });

  it("accepts a real leap day", () => {
    const result = checkReceiptDate("2024-02-29", "2024-03-01", "2024-03-01");
    expect(result.date).toBe("2024-02-29");
    expect(result.usedPhotoFallback).toBe(false);
  });
});

describe("year slips", () => {
  // Observed in production: a receipt printing 08/26/2026 came back as 2023-08-26. Month and day
  // exactly right, year three off — a misread digit, not a three-year-old receipt.
  it("repairs a year when month and day match the photo exactly", () => {
    expect(checkReceiptDate("2023-08-26", TODAY, PHOTO)).toEqual({
      date: "2026-08-26",
      dateWarning: true,
      usedPhotoFallback: false,
      repairedFromYear: "2023",
    });
  });

  // The repair overrides a year the model claims it read, so it has to say so: a bare
  // "check year" leaves the user unable to tell a correction from an ordinary warning, and
  // unable to put back a year that was right all along.
  it("reports the year it replaced, so the change is visible and reversible", () => {
    expect(checkReceiptDate("2023-08-26", TODAY, PHOTO).repairedFromYear).toBe("2023");
  });

  it("reports no replaced year when nothing was repaired", () => {
    expect(checkReceiptDate("2025-03-14", TODAY, PHOTO).repairedFromYear).toBeUndefined();
    expect(checkReceiptDate("2026-08-26", TODAY, PHOTO).repairedFromYear).toBeUndefined();
  });

  it("keeps the warning on after repairing, because the repair is an inference", () => {
    // The user can see the receipt and this code cannot, so a corrected date is still offered
    // for confirmation rather than asserted.
    expect(checkReceiptDate("2023-08-26", TODAY, PHOTO).dateWarning).toBe(true);
  });

  it("repairs a year in the future the same way", () => {
    expect(checkReceiptDate("2031-08-26", TODAY, PHOTO).date).toBe("2026-08-26");
  });

  // The guard has to stay narrow: a genuinely old receipt is a real thing a user may scan, and
  // rewriting its date would be a silent data error rather than a visible one.
  it("leaves a genuinely different date alone, warning instead", () => {
    expect(checkReceiptDate("2025-03-14", TODAY, PHOTO)).toEqual({
      date: "2025-03-14",
      dateWarning: true,
      usedPhotoFallback: false,
    });
  });

  it("does not repair when only the day differs", () => {
    expect(checkReceiptDate("2025-08-25", TODAY, PHOTO).date).toBe("2025-08-25");
  });

  it("does not repair when only the month differs", () => {
    expect(checkReceiptDate("2025-07-26", TODAY, PHOTO).date).toBe("2025-07-26");
  });

  // A receipt photographed days after the purchase: the photo's date is not today's, and the
  // repair must anchor to the photo, since that is what bounds when the purchase happened.
  it("anchors the repair to the photo's date, not today's", () => {
    const result = checkReceiptDate("2023-08-20", "2026-08-26", "2026-08-20");
    expect(result.date).toBe("2026-08-20");
    expect(result.dateWarning).toBe(true);
  });

  // A receipt cannot be photographed before it exists, so an OCR year later than the photo's is
  // impossible rather than merely suspicious. The same-year shortcut used to return here with no
  // warning at all, because the OCR year matched today's.
  it("repairs a receipt dated after its own photo", () => {
    expect(checkReceiptDate("2026-08-26", "2026-09-01", "2025-08-26")).toEqual({
      date: "2025-08-26",
      dateWarning: true,
      usedPhotoFallback: false,
      repairedFromYear: "2026",
    });
  });

  // Cross-year scanning is legitimate — a December receipt entered in January — and the warning
  // alone is the right response there.
  it("warns without repairing a receipt from late last year", () => {
    const result = checkReceiptDate("2025-12-30", "2026-01-04", "2026-01-04");
    expect(result.date).toBe("2025-12-30");
    expect(result.dateWarning).toBe(true);
  });
});
