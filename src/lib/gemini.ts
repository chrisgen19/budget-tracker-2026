import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentParameters, type ThinkingConfig } from "@google/genai";
import { GEMINI_FALLBACK_ATTEMPTS, GEMINI_MAX_ATTEMPTS, GEMINI_TIMEOUT_MS } from "@/lib/gemini-limits";

const globalForGemini = globalThis as unknown as {
  gemini: GoogleGenAI | undefined;
};

export const gemini =
  globalForGemini.gemini ?? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

if (process.env.NODE_ENV !== "production") globalForGemini.gemini = gemini;

/**
 * The model every Gemini call in this app uses.
 *
 * The default is kept in step with what production actually sets. It drifted once already:
 * the Telegram classifier pinned the old default as a literal, so it ran two generations
 * behind everything else in the same process and degraded as misrouted intent rather than as
 * an error (#163). Import this; never write a model id at a call site.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

/** Model to retry on after the primary model exhausts its overload retries. A generation
 *  behind the primary on purpose: the failure this covers is the newest model being
 *  overloaded, which retrying on the same generation does least to escape.
 *  Set GEMINI_FALLBACK_MODEL="" to disable fallback entirely. */
export const GEMINI_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash";

/** Thinking budget for Gemini 2.x models — -1 enables dynamic thinking (model decides,
 *  best extraction quality), 0 disables thinking (fastest "speed mode"),
 *  128-24576 sets a fixed token budget.
 *  Configured via GEMINI_THINKING_BUDGET; defaults to -1. */
const parsedThinkingBudget = Number.parseInt(process.env.GEMINI_THINKING_BUDGET ?? "", 10);
export const GEMINI_THINKING_BUDGET = Number.isNaN(parsedThinkingBudget) ? -1 : parsedThinkingBudget;

/** Thinking level for Gemini 3+ models (they use thinkingLevel, not thinkingBudget) —
 *  "medium" is the model default for 3.5 Flash (best extraction quality);
 *  "minimal" is the fastest "speed mode".
 *  Configured via GEMINI_THINKING_LEVEL; defaults to medium. */
const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
export const GEMINI_THINKING_LEVEL =
  THINKING_LEVELS[(process.env.GEMINI_THINKING_LEVEL ?? "medium").toLowerCase()] ??
  ThinkingLevel.MEDIUM;

/** Per-attempt request timeout — overloaded Gemini attempts can hang 40-70s before
 *  failing; aborting early lets retries/fallback kick in sooner.
 *  Configured via GEMINI_TIMEOUT_MS; defaults to 60s, generous enough for
 *  thinking-enabled scans. Lower it (e.g. 30000) when running in speed mode.
 *  Lives in gemini-limits.ts so callers can reason about call duration without
 *  importing this module's client. */
export { GEMINI_TIMEOUT_MS };

/** Pick the right thinking knob per model generation:
 *  Gemini 1.x/2.x use thinkingBudget; Gemini 3+ use thinkingLevel
 *  (thinkingBudget is only backwards-compat there and performs worse). */
const thinkingConfigFor = (model: string): ThinkingConfig =>
  /^gemini-[12]\./.test(model)
    ? { thinkingBudget: GEMINI_THINKING_BUDGET }
    : { thinkingLevel: GEMINI_THINKING_LEVEL };

/**
 * The cheapest thinking the model offers, expressed in whichever knob its generation uses.
 *
 * For work that is *classification* rather than reasoning. The Telegram classifier picks one of
 * eleven action labels from a prompt that already names every option; deliberating over that buys
 * nothing and costs latency on the hot path of every free-text message (#163).
 *
 * Exported so `generateContentWithRetry` can rebuild it for the fallback model — see the
 * `thinkingFor` parameter there for why passing the primary's config through would be wrong.
 */
export const minimalThinkingFor = (model: string): ThinkingConfig =>
  /^gemini-[12]\./.test(model)
    ? { thinkingBudget: 0 }
    : { thinkingLevel: ThinkingLevel.MINIMAL };

/** JSON-only responses (no markdown fences) + a per-attempt timeout, with thinking supplied by
 *  the caller. Shared so the two configs below cannot drift on anything but the thinking. */
const jsonConfig = (thinking: ThinkingConfig) => ({
  responseMimeType: "application/json",
  thinkingConfig: thinking,
  ...(GEMINI_TIMEOUT_MS > 0 && { httpOptions: { timeout: GEMINI_TIMEOUT_MS } }),
});

/** Receipt scanning: env-configurable thinking matched to the model's generation. This is the one
 *  call where reasoning earns its cost — OCR on a crumpled phone photo — so it keeps the default. */
export const receiptScanConfig = (model: string = GEMINI_MODEL) =>
  jsonConfig(thinkingConfigFor(model));

/** Intent classification: minimal thinking, deliberately not env-configurable. `GEMINI_THINKING_LEVEL`
 *  is shared with receipt scanning, so turning it down globally would trade scan accuracy for
 *  classifier latency — the wrong trade, and the reason this is a separate config rather than a knob. */
export const classifyConfig = (model: string = GEMINI_MODEL) =>
  jsonConfig(minimalThinkingFor(model));

/** Transient Gemini errors worth retrying, per Google's error guidance:
 *  429 (rate limit), 500 (INTERNAL — unexpected error on Google's side),
 *  503 (UNAVAILABLE — model overloaded), 504 (DEADLINE_EXCEEDED — Google's
 *  server-side deadline expired before the request finished) */
const RETRYABLE_STATUSES = new Set([429, 500, 503, 504]);

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
 *
 * `thinkingFor` is how a caller keeps its thinking *intent* across the fallback. The config is
 * rebuilt rather than carried over because the two models need not be the same generation — the
 * README suggests `gemini-2.5-flash-lite` as a fast fallback, and a `thinkingLevel` built for a
 * 3.x primary is the wrong knob for it. Passing the caller's config through unchanged would send
 * that wrong knob; ignoring the caller, as this used to, silently restored the default and undid
 * a deliberate `minimal` mid-retry.
 */
export const generateContentWithRetry = async (
  params: GenerateContentParameters,
  maxAttempts = GEMINI_MAX_ATTEMPTS,
  thinkingFor: (model: string) => ThinkingConfig = thinkingConfigFor
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
        config: { ...params.config, thinkingConfig: thinkingFor(GEMINI_FALLBACK_MODEL) },
      },
      GEMINI_FALLBACK_ATTEMPTS
    );
  }
};
