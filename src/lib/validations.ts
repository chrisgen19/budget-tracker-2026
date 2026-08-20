import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const transactionSchema = z.object({
  amount: z.number().positive("Amount must be greater than 0"),
  description: z.string().max(255).default(""),
  type: z.enum(["INCOME", "EXPENSE"]),
  date: z.string().min(1, "Date is required"),
  categoryId: z.string().min(1, "Category is required"),
  labelIds: z.array(z.string()).optional(),
});

export const batchTransactionSchema = transactionSchema.extend({
  receiptGroupId: z.string().optional(),
  receiptBreakdown: z.any().optional(),
});

export const labelScheduleSchema = z.object({
  id: z.string().optional(),
  days: z.array(z.number().int().min(0).max(6)).min(1, "Select at least one day"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time format"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time format"),
}).refine(
  (s) => s.startTime < s.endTime,
  { message: "End time must be after start time (overnight ranges not supported)", path: ["endTime"] }
);

export const labelSchema = z.object({
  name: z.string().min(1, "Name is required").max(30),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
  applicableTo: z.enum(["EXPENSE", "INCOME", "BOTH"]).default("BOTH"),
  schedules: z.array(labelScheduleSchema).max(10, "Maximum 10 schedules per label").optional(),
});

export const categorySchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  type: z.enum(["INCOME", "EXPENSE"]),
  icon: z.string().min(1, "Icon is required"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
});

export const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  currency: z.string().min(1, "Currency is required"),
  timezoneOffset: z.number().int(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(6, "Password must be at least 6 characters"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type TransactionInput = z.infer<typeof transactionSchema>;
export type LabelInput = z.infer<typeof labelSchema>;
export type LabelScheduleInput = z.infer<typeof labelScheduleSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const receiptBreakdownLineItemSchema = z.object({
  name: z.string().max(255),
  amount: z.number().positive(),
});

/** Ceiling on one batch-create request. Multi-scan Save All sends every reviewed row in a
 *  single atomic request, and one upload can expand well past the old cap of 50 once
 *  receipts are itemised into per-category children. Overflowing it failed the whole save
 *  with a generic "Invalid input" after the scan credits had already been spent. */
export const MAX_BATCH_TRANSACTIONS = 200;

export const receiptBreakdownItemSchema = z.object({
  amount: z.number().positive(),
  categoryId: z.string().min(1),
  description: z.string().max(255),
  lineItems: z.array(receiptBreakdownLineItemSchema).min(1).max(50),
});

/** Signal from Gemini distinguishing "date read off the receipt" from "date is the photo-fallback we instructed".
 *  Required: a missing field would silently default to OCR and re-mask the photo-fallback path,
 *  so we'd rather reject the response (422) than silently drop it. */
const dateSourceSchema = z.enum(["OCR", "PHOTO_FALLBACK"]);

export const receiptBreakdownResultSchema = z.object({
  date: z.string().min(1),
  dateSource: dateSourceSchema,
  items: z.array(receiptBreakdownItemSchema).min(1).max(20),
});

export const receiptScanResultSchema = z.object({
  amount: z.number().positive(),
  categoryId: z.string().min(1),
  date: z.string().min(1),
  dateSource: dateSourceSchema,
  description: z.string().max(255),
  type: z.literal("EXPENSE"),
  multiCategory: z.boolean(),
  breakdown: z.array(receiptBreakdownItemSchema).min(1).max(20).optional(),
});

export const updateAppSettingsSchema = z.object({
  role: z.enum(["FREE", "PAID"]),
  receiptScanEnabled: z.boolean().optional(),
  maxUploadFiles: z.number().int().min(1).max(50).optional(),
  monthlyScanLimit: z.number().int().min(0).max(1000).optional(),
});

export const scheduledTransactionSchema = z.object({
  amount: z.number().positive("Amount must be greater than 0"),
  description: z.string().max(255).default(""),
  type: z.enum(["INCOME", "EXPENSE"]),
  categoryId: z.string().min(1, "Category is required"),
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "ANNUALLY", "CUSTOM"]),
  customIntervalDays: z.number().int().min(1).optional(),
  reminderDaysBefore: z.number().int().min(0).max(30).default(0),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
}).refine(
  (data) => data.frequency !== "CUSTOM" || (data.customIntervalDays != null && data.customIntervalDays >= 1),
  { message: "Custom interval is required for custom frequency", path: ["customIntervalDays"] }
).refine(
  (data) => !data.endDate || new Date(data.endDate) >= new Date(data.startDate),
  { message: "End date must be on or after start date", path: ["endDate"] }
);

export const billActionSchema = z.object({
  action: z.enum(["pay", "pay_existing", "skip", "snooze"]),
  dueDate: z.string().min(1, "Due date is required"),
  transactionId: z.string().optional(),
  snoozeDays: z.number().int().min(1).max(7).optional(),
}).refine(
  (data) => data.action !== "pay_existing" || (data.transactionId != null && data.transactionId.length > 0),
  { message: "Transaction ID is required for pay_existing", path: ["transactionId"] }
);

export type ScheduledTransactionInput = z.infer<typeof scheduledTransactionSchema>;
export type BillActionInput = z.infer<typeof billActionSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export const validDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }, "Invalid calendar date");

/**
 * `Date.getTimezoneOffset()` in minutes. Real offsets span UTC-14 to UTC+14, so
 * anything outside +/-840 is malformed and would silently shift the user's
 * calendar day.
 */
export const timezoneOffsetParam = z.coerce.number().int().min(-840).max(840);

export const analyticsQuerySchema = z.object({
  granularity: z.enum(["weekly", "monthly", "yearly"]),
  from: validDateString,
  to: validDateString,
  tz: z.coerce.number().int(),
  type: z.enum(["ALL", "INCOME", "EXPENSE"]).default("ALL"),
}).refine((data) => data.from <= data.to, {
  message: "from must not be after to",
  path: ["from"],
});

export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;

/* ------------------------------------------------------------------ */
/*  AI Assessment                                                      */
/* ------------------------------------------------------------------ */

/* LLM output is variable — these helpers normalize common quirks so valid-but-messy
 * responses still parse instead of failing the whole generation. */

/** Accepts "High"/"moderate"/etc. → high|medium|low, defaulting to "medium". */
const severityField = z
  .preprocess((v) => {
    if (typeof v !== "string") return "medium";
    const s = v.toLowerCase();
    if (s.startsWith("h") || s.includes("critical") || s.includes("urgent")) return "high";
    if (s.startsWith("l") || s.includes("minor")) return "low";
    return "medium";
  }, z.enum(["high", "medium", "low"]))
  .catch("medium");

/** Accepts a number, "₱9,000", "9000", null/"" → number | null. */
const moneyField = z
  .preprocess((v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const n = Number(v.replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) && v.trim() !== "" ? n : null;
    }
    return null;
  }, z.number().nonnegative().nullable())
  .catch(null);

const tipField = z.object({
  title: z.string().catch(""),
  detail: z.string().catch(""),
});

/** Validates the structured-JSON assessment. Resilient: bad/extra fields fall back
 *  to safe defaults rather than failing the whole parse. */
export const assessmentReportSchema = z.object({
  summary: z.string().catch(""),
  scoreCommentary: z.string().catch(""),
  watchList: z.array(z.object({
    title: z.string().catch(""),
    detail: z.string().catch(""),
    severity: severityField,
  })).catch([]),
  cutBack: z.array(z.object({
    title: z.string().catch(""),
    reason: z.string().catch(""),
    suggestion: z.string().catch(""),
    estimatedMonthlySaving: moneyField,
  })).catch([]),
  boostSavings: z.array(tipField).catch([]),
  earnIdeas: z.array(tipField).catch([]),
  quickActions: z.array(z.string()).catch([]),
});

/** Validates the grounded web-tips JSON (sources come separately from grounding metadata). */
export const webTipsSchema = z.object({
  webTips: z.array(tipField).catch([]),
});

/** Validates the lightweight daily tip JSON. */
export const dailyTipSchema = z.object({
  tip: z.string().min(1).max(400),
  rationale: z.string().min(1).max(400),
});

export type AssessmentReportResult = z.infer<typeof assessmentReportSchema>;
export type WebTipsResult = z.infer<typeof webTipsSchema>;
export type DailyTipResult = z.infer<typeof dailyTipSchema>;

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ReceiptScanResult = z.infer<typeof receiptScanResultSchema>;
export type ReceiptBreakdownResult = z.infer<typeof receiptBreakdownResultSchema>;
export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;
