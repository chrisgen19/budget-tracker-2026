import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentParameters, type ThinkingConfig } from "@google/genai";

const globalForGemini = globalThis as unknown as {
  gemini: GoogleGenAI | undefined;
};

export const gemini =
  globalForGemini.gemini ?? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

if (process.env.NODE_ENV !== "production") globalForGemini.gemini = gemini;

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/** Model to retry on after the primary model exhausts its overload retries.
 *  Set GEMINI_FALLBACK_MODEL="" to disable fallback entirely. */
export const GEMINI_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL ?? "gemini-2.5-flash";

/** Thinking budget for Gemini 2.x models — 0 disables thinking (fastest, recommended for OCR),
 *  -1 enables dynamic thinking (model decides), 128-24576 sets a fixed token budget.
 *  Configured via GEMINI_THINKING_BUDGET; defaults to 0. */
const parsedThinkingBudget = Number.parseInt(process.env.GEMINI_THINKING_BUDGET ?? "", 10);
export const GEMINI_THINKING_BUDGET = Number.isNaN(parsedThinkingBudget) ? 0 : parsedThinkingBudget;

/** Thinking level for Gemini 3+ models (they use thinkingLevel, not thinkingBudget) —
 *  "minimal" is fastest (recommended for OCR); "medium" is the model default for 3.5 Flash.
 *  Configured via GEMINI_THINKING_LEVEL; defaults to minimal. */
const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
export const GEMINI_THINKING_LEVEL =
  THINKING_LEVELS[(process.env.GEMINI_THINKING_LEVEL ?? "minimal").toLowerCase()] ??
  ThinkingLevel.MINIMAL;

/** Per-attempt request timeout — overloaded Gemini attempts can hang 40-70s before
 *  failing; aborting early lets retries/fallback kick in sooner.
 *  Configured via GEMINI_TIMEOUT_MS; defaults to 30s. Raise it if you enable
 *  deeper thinking (dynamic budget or medium/high level). */
const parsedTimeout = Number.parseInt(process.env.GEMINI_TIMEOUT_MS ?? "", 10);
export const GEMINI_TIMEOUT_MS = Number.isNaN(parsedTimeout) ? 30_000 : parsedTimeout;

/** Pick the right thinking knob per model generation:
 *  Gemini 1.x/2.x use thinkingBudget; Gemini 3+ use thinkingLevel
 *  (thinkingBudget is only backwards-compat there and performs worse). */
const thinkingConfigFor = (model: string): ThinkingConfig =>
  /^gemini-[12]\./.test(model)
    ? { thinkingBudget: GEMINI_THINKING_BUDGET }
    : { thinkingLevel: GEMINI_THINKING_LEVEL };

/** Generation config for receipt scanning: JSON-only responses (no markdown fences)
 *  + env-configurable thinking matched to the model's generation + per-attempt timeout */
export const receiptScanConfig = (model: string = GEMINI_MODEL) => ({
  responseMimeType: "application/json",
  thinkingConfig: thinkingConfigFor(model),
  ...(GEMINI_TIMEOUT_MS > 0 && { httpOptions: { timeout: GEMINI_TIMEOUT_MS } }),
});

/** Transient Gemini errors worth retrying: 429 (rate limit) and 503 (model overloaded) */
const RETRYABLE_STATUSES = new Set([429, 503]);

/** True when Gemini rejected the call due to temporary overload or rate limiting */
export const isGeminiOverloaded = (error: unknown): boolean =>
  error instanceof ApiError && RETRYABLE_STATUSES.has(error.status);

/** True when the request was aborted by the per-attempt timeout */
const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

/** True when Gemini is temporarily unavailable: overloaded, rate limited, or unresponsive */
export const isGeminiUnavailable = (error: unknown): boolean =>
  isGeminiOverloaded(error) || isTimeoutError(error);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const attemptWithRetries = async (
  params: GenerateContentParameters,
  maxAttempts: number
) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await gemini.models.generateContent(params);
    } catch (error) {
      if (!isGeminiUnavailable(error) || attempt >= maxAttempts) throw error;
      await sleep(attempt * 1000);
    }
  }
};

/**
 * Call Gemini with automatic retries on transient 429/503 errors (1s, 2s backoff).
 * If the primary model stays overloaded after all attempts, retries once on
 * GEMINI_FALLBACK_MODEL (with thinking config rebuilt for that model) before
 * giving up. Non-retryable errors are rethrown immediately.
 */
export const generateContentWithRetry = async (
  params: GenerateContentParameters,
  maxAttempts = 3
) => {
  try {
    return await attemptWithRetries(params, maxAttempts);
  } catch (error) {
    if (
      !isGeminiUnavailable(error) ||
      !GEMINI_FALLBACK_MODEL ||
      GEMINI_FALLBACK_MODEL === params.model
    ) {
      throw error;
    }
    console.warn(
      `[gemini] ${String(params.model)} overloaded after ${maxAttempts} attempts — falling back to ${GEMINI_FALLBACK_MODEL}`
    );
    return attemptWithRetries(
      {
        ...params,
        model: GEMINI_FALLBACK_MODEL,
        config: { ...params.config, thinkingConfig: thinkingConfigFor(GEMINI_FALLBACK_MODEL) },
      },
      2
    );
  }
};
