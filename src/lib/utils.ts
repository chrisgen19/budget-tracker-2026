/** Merge class names, filtering out falsy values */
export const cn = (...classes: (string | boolean | undefined | null)[]) =>
  classes.filter(Boolean).join(" ");

/** Format a number as currency */
export const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount);

/** Format a date for display */
export const formatDate = (date: Date | string): string =>
  new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));

/** Format a date for input[type=date] */
export const formatDateInput = (date: Date | string): string => {
  const d = new Date(date);
  return d.toISOString().split("T")[0];
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
