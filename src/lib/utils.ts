/** Merge class names, filtering out falsy values */
export const cn = (...classes: (string | boolean | undefined | null)[]) =>
  classes.filter(Boolean).join(" ");

/** Format a number as currency (uses Intl defaults per currency, e.g. 0 decimals for JPY/KRW) */
export const formatCurrency = (amount: number, currency = "PHP"): string =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amount);

/** Get the symbol for a currency code: "PHP" → "₱", "USD" → "$" */
export const getCurrencySymbol = (currency = "PHP"): string =>
  new Intl.NumberFormat("en", { style: "currency", currency })
    .formatToParts(0)
    .find((p) => p.type === "currency")?.value ?? currency;

/** Format a date for display */
export const formatDate = (date: Date | string): string =>
  new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));

/** Format a date for input[type=datetime-local] */
export const formatDateInput = (date: Date | string): string => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

/** Get month name from date */
export const getMonthName = (date: Date | string): string =>
  new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(date));

/** Get start and end of current month */
export const getCurrentMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
};

const MAX_IMAGE_DIMENSION = 1500;
const JPEG_QUALITY = 0.75;

/**
 * Compress an image file by resizing to max 1500px and re-encoding as JPEG.
 * Reduces ~4 MB camera photos to ~200-400 KB for faster uploads.
 */
export const compressImage = (file: File): Promise<File> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file); // fallback to original if canvas unavailable
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
            type: "image/jpeg",
          }));
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for compression"));
    };

    img.src = url;
  });
