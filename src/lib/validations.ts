import { z } from "zod";
import { grantsWrite, mcpScopeSchema } from "@/lib/mcp/scopes";
import { MAX_BREAKDOWN_GROUPS, MAX_BREAKDOWN_LINE_ITEMS } from "@/lib/receipt-limits";

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

/**
 * The fields of a transaction, before the transfer rules are applied.
 *
 * Kept as a bare `ZodObject` so `batchTransactionSchema` can `.extend()` it. Applying `.refine()`
 * first would produce a `ZodEffects`, which has no `.extend`, and unwrapping it with
 * `.innerType()` only strips one refinement of the four.
 */
const transactionBaseSchema = z.object({
  amount: z.number().positive("Amount must be greater than 0"),
  description: z.string().max(255).default(""),
  type: z.enum(["INCOME", "EXPENSE", "TRANSFER"]),
  date: z.string().min(1, "Date is required"),
  categoryId: z.string().min(1, "Category is required"),
  labelIds: z.array(z.string()).optional(),
  /** Where the money moved through. For a TRANSFER, the side it leaves. */
  accountId: z.string().min(1).nullish(),
  /** Where a TRANSFER lands. Set if and only if `type` is TRANSFER. */
  transferAccountId: z.string().min(1).nullish(),
});

/** The shape every write path checks, whatever else it adds on top. */
type TransferShape = {
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  accountId?: string | null;
  transferAccountId?: string | null;
};

/**
 * Tie `type`, `accountId` and `transferAccountId` together.
 *
 * Applied to the single-transaction schema and the batch schema alike, so the MCP and receipt
 * write paths cannot produce a shape the form would refuse. It mirrors the
 * `transactions_transfer_shape_check` constraint added in migration 20260830100001: the database
 * is what actually guarantees the invariant, and this is what turns a violation into a readable
 * field error instead of a raw Postgres exception surfacing as a 500.
 */
const withTransferRules = <Output extends TransferShape, Def extends z.ZodTypeDef, Input>(
  // Spelled out as the three-parameter `ZodType` rather than `T extends z.ZodType<TransferShape>`:
  // the shorter constraint erases the schema's real output type down to `TransferShape`, so every
  // consumer of the result loses `amount`, `date`, `labelIds` and the rest.
  schema: z.ZodType<Output, Def, Input>
) =>
  schema
    .refine((d) => d.type !== "TRANSFER" || !!d.transferAccountId, {
      message: "Choose the account the money goes to",
      path: ["transferAccountId"],
    })
    .refine((d) => d.type !== "TRANSFER" || !!d.accountId, {
      // A transfer with no source is money arriving from nowhere: it raises the destination
      // balance while lowering nothing, the same silent imbalance this feature exists to remove.
      // An ordinary income or expense may legitimately have no account.
      message: "Choose the account the money comes from",
      path: ["accountId"],
    })
    .refine((d) => d.type === "TRANSFER" || !d.transferAccountId, {
      message: "Only a transfer can have a destination account",
      path: ["transferAccountId"],
    })
    .refine((d) => !d.transferAccountId || d.transferAccountId !== d.accountId, {
      message: "Choose two different accounts",
      path: ["transferAccountId"],
    });

export const transactionSchema = withTransferRules(transactionBaseSchema);

export const accountSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  type: z.enum(["CASH", "BANK", "CREDIT_CARD", "EWALLET"]),
  /**
   * Signed the same way balances are: positive is money you have, negative is money you owe. A
   * credit card already carrying debt is entered as a negative number, which is why this is not
   * constrained to be positive.
   */
  openingBalance: z.number().default(0),
  creditLimit: z.number().positive().nullish(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format").default("#8B6FC0"),
  icon: z.string().min(1).default("Wallet"),
  isActive: z.boolean().default(true),
}).refine((d) => d.type === "CREDIT_CARD" || d.creditLimit == null, {
  message: "Only a credit card can have a credit limit",
  path: ["creditLimit"],
});

export type AccountInput = z.infer<typeof accountSchema>;

export const receiptBreakdownLineItemSchema = z.object({
  name: z.string().max(255),
  amount: z.number().positive(),
});

/**
 * The blob persisted to `transactions.receipt_breakdown`.
 *
 * This is assembled client-side from an already-validated scan result and posted back, so
 * before this schema existed the column accepted `z.any()` and stored whatever arrived. That
 * pushed the burden onto every reader: `getReceiptItems` has to parse defensively, and
 * `ReceiptBreakdown` renders `breakdown.items.length` with no guard, so a blob missing `items`
 * was a render-time TypeError rather than a degraded display.
 *
 * The bounds mirror what the client actually produces (`use-multi-scan.ts`: `total` is the
 * item's own positive amount, `items` are the line items already checked by
 * `receiptBreakdownItemSchema`), so nothing the app legitimately writes is rejected. They also
 * bound the stored size, which `MAX_BATCH_TRANSACTIONS` did not: it caps rows, not blob size.
 *
 * `.strict()` keeps unknown keys out of the column rather than letting arbitrary payload ride
 * along inside the JSON.
 */
export const receiptBreakdownMetaSchema = z
  .object({
    total: z.number().positive(),
    items: z.array(receiptBreakdownLineItemSchema).min(1).max(MAX_BREAKDOWN_LINE_ITEMS),
  })
  .strict();

const batchTransactionBaseSchema = transactionBaseSchema.extend({
  receiptGroupId: z.string().optional(),
  receiptBreakdown: receiptBreakdownMetaSchema.optional(),
});

export const batchTransactionSchema = withTransferRules(batchTransactionBaseSchema);

/** One item accepted by `createTransactionBatch`. Exported so the shared write service and the
 *  MCP tool type against the schema rather than restating its shape. */
export type BatchTransactionInput = z.infer<typeof batchTransactionSchema>;

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
export type SpendingType = "INCOME" | "EXPENSE";
export type LabelInput = z.infer<typeof labelSchema>;
export type LabelScheduleInput = z.infer<typeof labelScheduleSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Ceiling on one batch-create request. Multi-scan Save All sends every reviewed row in a
 *  single atomic request, and one upload can expand well past the old cap of 50 once
 *  receipts are itemised into per-category children. Overflowing it failed the whole save
 *  with a generic "Invalid input" after the scan credits had already been spent. */
export const MAX_BATCH_TRANSACTIONS = 200;

/** Longest lifetime the MCP token UI will mint. Anything longer is re-minted deliberately. */
export const MAX_TOKEN_EXPIRY_DAYS = 365;

/** Longest lifetime for a token that can write. Shorter than the read cap on purpose: it bounds
 *  how long a leaked writing credential stays useful, which revocation alone cannot do when the
 *  leak goes unnoticed. */
export const MAX_WRITE_TOKEN_EXPIRY_DAYS = 90;

/** Ceiling on a single MCP write lease: 30 days. Long enough for "leave it on while I work
 *  through the backlog", short enough that a forgotten lease still closes itself. */
export const MAX_WRITE_LEASE_MINUTES = 30 * 24 * 60;

/** Idempotency key accepted by POST /api/transactions/batch, so an ambiguous failure
 *  (committed, response lost) can be retried without creating the receipts twice. */
export const clientBatchIdSchema = z.string().uuid();

export const receiptBreakdownItemSchema = z.object({
  amount: z.number().positive(),
  categoryId: z.string().min(1),
  description: z.string().max(255),
  lineItems: z.array(receiptBreakdownLineItemSchema).min(1).max(MAX_BREAKDOWN_LINE_ITEMS),
});

/** Signal from Gemini distinguishing "date read off the receipt" from "date is the photo-fallback we instructed".
 *  Required: a missing field would silently default to OCR and re-mask the photo-fallback path,
 *  so we'd rather reject the response (422) than silently drop it. */
const dateSourceSchema = z.enum(["OCR", "PHOTO_FALLBACK"]);

export const receiptBreakdownResultSchema = z.object({
  date: z.string().min(1),
  dateSource: dateSourceSchema,
  items: z.array(receiptBreakdownItemSchema).min(1).max(MAX_BREAKDOWN_GROUPS),
});

export const receiptScanResultSchema = z.object({
  amount: z.number().positive(),
  categoryId: z.string().min(1),
  date: z.string().min(1),
  dateSource: dateSourceSchema,
  description: z.string().max(255),
  type: z.literal("EXPENSE"),
  multiCategory: z.boolean(),
  breakdown: z.array(receiptBreakdownItemSchema).min(1).max(MAX_BREAKDOWN_GROUPS).optional(),
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
export type ReceiptBreakdownMetaInput = z.infer<typeof receiptBreakdownMetaSchema>;
export type UpdateAppSettingsInput = z.infer<typeof updateAppSettingsSchema>;

/** Provenance filter accepted by `GET /api/transactions` and the MCP search tool. */
export const transactionSourceSchema = z.enum(["APP", "MCP", "TELEGRAM"]);

/** What a minted token may claim to be. `APP` is excluded: it means the web app itself, which
 *  never uses a token, so offering it would let a token forge rows as hand-typed. */
export const mcpTokenSourceSchema = z.enum(["MCP", "TELEGRAM"]);

export type McpTokenSource = z.infer<typeof mcpTokenSourceSchema>;

/**
 * Minting an MCP token.
 *
 * A read-only credential that never expires is a contained risk: it can only ever disclose. One
 * that can also create rows is not, so a write grant must carry an end date, and a shorter one.
 * Enforced in the schema rather than only in the form, since the form is not the only thing that
 * can post this.
 */
export const createMcpTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    scopes: z.array(mcpScopeSchema).min(1),
    expiresInDays: z.number().int().min(1).max(MAX_TOKEN_EXPIRY_DAYS).nullable(),
    source: mcpTokenSourceSchema.default("MCP"),
  })
  .refine((v) => !(grantsWrite(v.scopes) && v.expiresInDays === null), {
    message: "A token with a write scope must expire",
    path: ["expiresInDays"],
  })
  .refine(
    (v) => !(grantsWrite(v.scopes) && (v.expiresInDays ?? 0) > MAX_WRITE_TOKEN_EXPIRY_DAYS),
    {
      message: `A token with a write scope may last at most ${MAX_WRITE_TOKEN_EXPIRY_DAYS} days`,
      path: ["expiresInDays"],
    }
  );

/**
 * One transaction accepted by the MCP write tool.
 *
 * Stricter than `batchTransactionSchema` on `date`, which only requires a non-empty string
 * because the app's own form supplies a picker-formatted value. Here the value comes from a
 * model, and an unparseable one used to reach Prisma and fail inside the transaction, which
 * reports UNKNOWN_WHETHER_SAVED and tells the caller to retry a request that can never succeed.
 */
/** `YYYY-MM-DD` with nothing after it. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ISO 8601 date, optionally with a time and offset. Anchored at both ends on purpose.
 *
 * `Date.parse` is far more permissive than this: it accepts `"0"`, `"2026"` and `"Mar 3 2026"`,
 * each of which becomes some real instant that bears no relation to what a user approved. The
 * tool documents an ISO date, so only that is accepted.
 */
const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export const isDateOnly = (value: string): boolean => DATE_ONLY.test(value);

/**
 * True only for a date that exists, whether or not it carries a time.
 *
 * `Date.parse` is not enough: JavaScript silently rolls impossible dates forward, so both
 * `2026-02-31` *and* `2026-02-31T00:00:00Z` parse fine and become 3 March. Storing a different
 * day from the one the user approved is worse than refusing the input, so the calendar
 * components are checked to survive the round trip, and the time components are range-checked.
 */
export const isRealDate = (value: string): boolean => {
  const match = ISO_DATE_TIME.exec(value);
  if (!match) return false;

  const [, ys, ms, ds, hs, mins, secs] = match;
  const [y, m, d] = [Number(ys), Number(ms), Number(ds)];

  const asUtc = new Date(Date.UTC(y, m - 1, d));
  if (asUtc.getUTCFullYear() !== y || asUtc.getUTCMonth() !== m - 1 || asUtc.getUTCDate() !== d) {
    return false;
  }

  if (hs !== undefined && (Number(hs) > 23 || Number(mins) > 59)) return false;
  if (secs !== undefined && Number(secs) > 59) return false;

  // Backstop for anything the pattern's shape admits but the runtime cannot represent, such as a
  // UTC offset of +24:00 or +14:61. Checking each component separately has now twice let a
  // narrower case through, so this bounds the whole class instead: whatever survives above must
  // also resolve to a real instant, or `new Date()` would produce Invalid Date, the write would
  // fail inside Prisma, and the caller would be told to retry a request that can never succeed.
  return Number.isFinite(Date.parse(value));
};

/**
 * Render a stored instant as the calendar day the user would see in the app.
 *
 * The tool's confirmation echoes the date back to the model, and a raw UTC slice reports the
 * wrong day for anyone east of Greenwich: a UTC+8 user's 1 March row is stored as
 * `2026-02-28T16:00:00Z`, so slicing the ISO string would claim 28 February for a transaction the
 * app correctly shows on 1 March.
 *
 * @param timezoneOffset Minutes, `getTimezoneOffset()` convention (UTC+8 is -480).
 */
export const formatLocalDate = (instant: Date, timezoneOffset: number): string =>
  new Date(instant.getTime() - timezoneOffset * 60_000).toISOString().slice(0, 10);

/**
 * Resolve an account-local date or datetime to its stored UTC instant.
 *
 * A bare `YYYY-MM-DD` parses as **midnight UTC**, which is the previous day for anyone west of
 * Greenwich: a 1 March transaction from a UTC-5 user lands inside February's range and shows up
 * in the wrong month. Every other write path already avoids this by attaching a local wall-clock
 * time before sending (`datetime-local` in the transaction form, `withLocalTime` in the scan
 * flow); the MCP tool is the only caller that receives a bare date, so it normalises here using
 * the same `Date.UTC(y, m, d) + tzOffset * 60000` formula the rest of the app uses for day and
 * month boundaries.
 *
 * A zone-less time is the user's saved wall clock and is resolved with `timezoneOffset`.
 * A value carrying `Z` or an explicit offset already identifies an instant and is preserved.
 *
 * @param timezoneOffset Minutes, `getTimezoneOffset()` convention (UTC+8 is -480).
 */
/**
 * Whether a supplied date carries a time that reflects reality.
 *
 * `resolveTransactionDate` fills a bare date with the current clock, which is right for entering
 * something as it happens and wrong for backdating: "yesterday's dinner" would be stamped with
 * this morning's time. That fabricated clock must not then drive schedule matching, or a Tuesday
 * dinner lands inside a weekday 05:00-17:00 window and gets tagged as work spending.
 *
 * Trustworthy when the caller gave a time, or when the date is today in the user's own timezone,
 * because filling "today" with "now" is what the app's own form does anyway.
 *
 * @param timezoneOffset Minutes, `getTimezoneOffset()` convention (UTC+8 is -480).
 */
export const hasTrustworthyTime = (
  value: string,
  timezoneOffset: number,
  now = new Date()
): boolean => {
  const match = ISO_DATE_TIME.exec(value);
  if (!match) return false;

  const [, ys, ms, ds, hs] = match;
  if (hs !== undefined) return true;

  const today = new Date(now.getTime() - timezoneOffset * 60_000).toISOString().slice(0, 10);
  return `${ys}-${ms}-${ds}` === today;
};

export const resolveTransactionDate = (
  value: string,
  timezoneOffset: number,
  now = new Date()
): string => {
  const match = ISO_DATE_TIME.exec(value);
  if (!match) return value;

  const [, ys, ms, ds, hs, mins, secs, zone] = match;

  // An explicit `Z` or offset already pins the instant, so it is used as given.
  if (zone) return value;

  // A bare date carries no time, so one has to be chosen. Midnight was the obvious anchor while
  // this only had to land in the right month, but it turned out to be a tell: every MCP row sat
  // at 12:00 AM while not one of the app's did. The form uses a `datetime-local` prefilled with
  // the current clock, and the scanner's `withLocalTime` attaches the current clock to date-only
  // OCR output, so "the user's current wall clock" is the convention this app already has.
  //
  // This only applies when no time was supplied. A model that heard "last night" should send one.
  const [clockH, clockM] = hs === undefined
    ? [
        new Date(now.getTime() - timezoneOffset * 60_000).getUTCHours(),
        new Date(now.getTime() - timezoneOffset * 60_000).getUTCMinutes(),
      ]
    : [Number(hs), mins === undefined ? 0 : Number(mins)];

  // Everything else carries a wall-clock reading with no zone: a bare date, or a time such as
  // `2026-08-25T23:30`. `new Date()` would resolve those against the *server's* timezone, which
  // is UTC in production, so the stored instant would depend on where the app happens to run
  // rather than on the user. Both are the user's local wall clock, resolved through the same
  // `Date.UTC(...) + tzOffset * 60000` formula the rest of the app uses for boundaries.
  const utcMs = Date.UTC(
    Number(ys),
    Number(ms) - 1,
    Number(ds),
    clockH,
    clockM,
    secs === undefined ? 0 : Number(secs)
  );
  return new Date(utcMs + timezoneOffset * 60_000).toISOString();
};

export const mcpTransactionSchema = withTransferRules(
  batchTransactionBaseSchema.extend({
    date: z.string().refine(isRealDate, {
      message: "date must be a real calendar date, e.g. 2026-08-25",
    }),
  })
);

/**
 * Write-lease duration, in minutes from now.
 *
 * Minutes rather than an absolute instant so the client never sends a time its clock disagrees
 * with, `null` to switch writes off, and a strict number rather than a coerced one: `Number(true)`
 * is 1 and `Number("60")` is 60, so a coercing check would let a stray boolean or string quietly
 * open the write window.
 */
export const mcpWriteLeaseSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_WRITE_LEASE_MINUTES)
  .nullable();

/**
 * Quick-pick id lists (`users.quick_expense_categories`, `quick_income_categories`, `quick_labels`).
 *
 * Uniqueness is enforced here rather than left to the resolver. These columns are plain `String[]`
 * with no foreign key, and the pickers count the stored list against their slot limit: four copies
 * of one id passed the old `length > 4` check, so the picker would count four entries while
 * rendering one tile selected and disable every remaining slot. That is the same dead end a
 * deleted category used to cause, reached from the other side.
 *
 * A duplicate is rejected rather than silently deduped. Neither picker can produce one (toggling
 * an already-selected id removes it), so a duplicate means a broken or hostile client, and quietly
 * rewriting the payload would hide that while still returning 200.
 */
export const quickPickIdsSchema = (max: number) =>
  z
    .array(z.string())
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "must not contain duplicate ids",
    });
