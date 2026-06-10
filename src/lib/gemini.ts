import { ApiError, GoogleGenAI, type GenerateContentParameters } from "@google/genai";

const globalForGemini = globalThis as unknown as {
  gemini: GoogleGenAI | undefined;
};

export const gemini =
  globalForGemini.gemini ?? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

if (process.env.NODE_ENV !== "production") globalForGemini.gemini = gemini;

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/** Transient Gemini errors worth retrying: 429 (rate limit) and 503 (model overloaded) */
const RETRYABLE_STATUSES = new Set([429, 503]);

/** True when Gemini rejected the call due to temporary overload or rate limiting */
export const isGeminiOverloaded = (error: unknown): boolean =>
  error instanceof ApiError && RETRYABLE_STATUSES.has(error.status);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call Gemini with automatic retries on transient 429/503 errors.
 * Backs off 1s, then 2s between attempts. Non-retryable errors are rethrown immediately.
 */
export const generateContentWithRetry = async (
  params: GenerateContentParameters,
  maxAttempts = 3
) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await gemini.models.generateContent(params);
    } catch (error) {
      lastError = error;
      if (!isGeminiOverloaded(error) || attempt === maxAttempts) throw error;
      await sleep(attempt * 1000);
    }
  }
  throw lastError; // unreachable — loop always returns or throws
};
