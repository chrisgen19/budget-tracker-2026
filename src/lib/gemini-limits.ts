/**
 * Timeout and retry policy for Gemini calls.
 *
 * Kept separate from `gemini.ts` because that module instantiates the `GoogleGenAI`
 * client at import time. Consumers that only need to reason about how long a call can
 * take — the scan quota's reservation TTL, for one — must not drag the SDK and an API
 * key requirement in with it.
 */

/** Per-attempt request timeout. Configured via GEMINI_TIMEOUT_MS; 0 disables it entirely. */
const parsedTimeout = Number.parseInt(process.env.GEMINI_TIMEOUT_MS ?? "", 10);
export const GEMINI_TIMEOUT_MS = Number.isNaN(parsedTimeout) ? 60_000 : parsedTimeout;

/** Attempts against the primary model before falling back. */
export const GEMINI_MAX_ATTEMPTS = 3;

/** Attempts against the fallback model after the primary stays overloaded. */
export const GEMINI_FALLBACK_ATTEMPTS = 2;

/** Backoff between attempts is `attempt * 1000`ms, so n attempts sleep 1+2+...+(n-1) seconds. */
const backoffMs = (attempts: number) => ((attempts - 1) * attempts * 1000) / 2;

/**
 * Worst-case wall time for one `generateContentWithRetry` call at a given per-attempt
 * timeout: every primary attempt timing out, then every fallback attempt timing out, plus
 * the backoff between them.
 *
 * `null` when the timeout is 0, because an untimed request has no bound at all.
 *
 * Exported as a function, not just the derived constant, so callers can verify their own
 * timing assumptions across configurations rather than only the one this process booted with.
 */
export const geminiWorstCaseMs = (timeoutMs: number): number | null =>
  timeoutMs > 0
    ? timeoutMs * (GEMINI_MAX_ATTEMPTS + GEMINI_FALLBACK_ATTEMPTS) +
      backoffMs(GEMINI_MAX_ATTEMPTS) +
      backoffMs(GEMINI_FALLBACK_ATTEMPTS)
    : null;

/** Worst case for this process's configured timeout. */
export const GEMINI_WORST_CASE_MS: number | null = geminiWorstCaseMs(GEMINI_TIMEOUT_MS);
