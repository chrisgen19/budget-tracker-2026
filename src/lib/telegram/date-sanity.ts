/** A receipt photographed within a few days of purchase is ordinary; a wider gap is worth a look. */
const SUSPICIOUS_GAP_DAYS = 3;

const dayNumber = (isoDate: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000;
};

/**
 * Whether the date read off a receipt sits oddly far from when the photo was taken.
 *
 * The receipt's own date stays authoritative, because it is the date of the purchase and a photo
 * can legitimately be taken later. But a large gap usually means one of them was misread: a
 * smudged `08` becoming `03`, or a regulatory date on the receipt being picked up instead of the
 * transaction date. Saying so lets the user catch it before saving, which is the only moment they
 * still have the receipt in front of them.
 *
 * Only meaningful in one direction. A photo *predating* its receipt is impossible, so that is
 * always worth flagging; a photo taken well after is common enough that it needs a threshold.
 */
export const receiptDateLooksOff = (
  receiptDate: string,
  photoTakenAt: string | null
): boolean => {
  if (!photoTakenAt) return false;

  const receipt = dayNumber(receiptDate);
  const photo = dayNumber(photoTakenAt);
  if (receipt === null || photo === null) return false;

  // Negative means the receipt is dated after the photo, which cannot happen.
  const gap = photo - receipt;
  return gap < 0 || gap > SUSPICIOUS_GAP_DAYS;
};
