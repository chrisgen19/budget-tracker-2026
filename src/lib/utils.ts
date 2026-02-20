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
