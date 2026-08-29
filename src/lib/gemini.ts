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

/**
 * A model id with the resource prefix removed.
 *
 * The SDK accepts both `gemini-2.5-flash` and the resource form `models/gemini-2.5-flash`, and
 * passes the latter through untouched (see `tModel` in @google/genai), so both can reach us from
 * `GEMINI_MODEL`. Testing the raw string would read the prefixed form as generation-less and pick
 * the wrong knob — and sending `thinkingLevel` to a 2.x model is a non-retryable 400.
 */
const bareModel = (model: string): string => model.replace(/^models\//, "");

/**
 * Whether a model takes the legacy `thinkingBudget` rather than `thinkingLevel`.
 *
 * A model id that names no generation — the hot-swapping aliases such as `gemini-flash-latest` —
 * falls to the `thinkingLevel` side deliberately. That is the knob every current and future model
 * uses; the 2.x line is being retired, and the alias that historically pointed at a 2.x model now
 * resolves to a 3.x one. Guessing forwards is right for every model that exists today and wrong
 * only for a regression that is not going to happen.
 */
const isLegacyThinkingModel = (model: string): boolean => /^gemini-[12]\./.test(bareModel(model));

/** Pick the right thinking knob per model generation:
 *  Gemini 1.x/2.x use thinkingBudget; Gemini 3+ use thinkingLevel
 *  (thinkingBudget is only backwards-compat there and performs worse). */
const thinkingConfigFor = (model: string): ThinkingConfig =>
  isLegacyThinkingModel(model)
    ? { thinkingBudget: GEMINI_THINKING_BUDGET }
    : { thinkingLevel: GEMINI_THINKING_LEVEL };

/**
 * Models documented to accept the cheapest level. Everything else falls back to `low`, which
 * appears in every row of the support table — 3.7 Flash, both Pro previews included.
 *
 * The floor is deliberately conservative because the cost is asymmetric. Too much thinking is
 * some latency; an *unsupported* value is a 400, which `classifyMessage` catches and turns into
 * `null`, reaching the user as "I couldn't understand that command" on every free-text message.
 *
 * This is not hypothetical, and it is not only a Pro-model problem: `gemini-3.7-flash` does not
 * support `minimal` either. Assuming a generation shares one floor is the same mistake as
 * assuming a model id can be written at a call site (#163) — it holds until the day it does not.
 */
const MINIMAL_LEVEL_MODELS = /^gemini-3\.(5|6)-flash/;

/** 2.5 Flash and Flash-Lite accept a zero budget. 2.5 Pro cannot disable thinking at all: its
 *  documented range starts at 128, so that is the lowest thing it can be asked for. */
const ZERO_BUDGET_MODELS = /^gemini-2\.5-flash/;

/** The floor for a 2.x model that does not accept zero. Documented minimum for 2.5 Pro. */
const MIN_THINKING_BUDGET = 128;

/**
 * The cheapest thinking a *given model* actually supports, in whichever knob its generation uses.
 *
 * For work that is *classification* rather than reasoning. The Telegram classifier picks one of
 * eleven action labels from a prompt that already names every option; deliberating over that buys
 * nothing and costs latency on the hot path of every free-text message (#163).
 *
 * Per model rather than per generation, because the capability genuinely varies within one:
 * `gemini-3.6-flash` and `gemini-3.5-flash` take `minimal`, `gemini-3.7-flash` and the Pro
 * previews do not. See the table-driven test for the documented matrix.
 *
 * Exported so `generateContentWithRetry` can rebuild it for the fallback model — see the
 * `thinkingFor` parameter there for why passing the primary's config through would be wrong.
 */
export const minimalThinkingFor = (model: string): ThinkingConfig =>
  isLegacyThinkingModel(model)
    ? { thinkingBudget: ZERO_BUDGET_MODELS.test(bareModel(model)) ? 0 : MIN_THINKING_BUDGET }
    : {
        thinkingLevel: MINIMAL_LEVEL_MODELS.test(bareModel(model))
          ? ThinkingLevel.MINIMAL
          : ThinkingLevel.LOW,
      };

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
