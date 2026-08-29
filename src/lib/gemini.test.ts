import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThinkingLevel } from "@google/genai";

/**
 * The thinking policy, and the fallback's handling of it.
 *
 * Two calls in this app want opposite things from the same client. Receipt scanning reads a
 * crumpled phone photo and should deliberate; intent classification picks one of eleven labels
 * from a prompt that lists them and should not. `GEMINI_THINKING_LEVEL` is shared, so it cannot
 * express both — which is why `classifyConfig` exists rather than a second env var.
 *
 * The fallback path is the subtle half: it rebuilds `thinkingConfig` for whichever model it
 * switches to, and used to rebuild it from the env default regardless of what the caller asked
 * for, silently restoring `medium` to a call that had deliberately chosen `minimal`.
 */

// Built at module scope and throws without a key, so this has to land before the import.
vi.hoisted(() => {
  process.env.GEMINI_API_KEY = "test-key";
});

const {
  gemini,
  classifyConfig,
  receiptScanConfig,
  minimalThinkingFor,
  generateContentWithRetry,
  GEMINI_FALLBACK_MODEL,
  GEMINI_THINKING_LEVEL,
} = await import("@/lib/gemini");

/** Retryable without being an ApiError: `isGeminiUnavailable` also treats an abort as transient,
 *  and this needs no knowledge of the SDK's error constructor. */
const transient = () => Object.assign(new Error("aborted"), { name: "AbortError" });

let generateContent: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  generateContent = vi.spyOn(gemini.models, "generateContent");
});

describe("thinking config per call site", () => {
  it("gives classification the cheapest knob its generation offers", () => {
    // 3.x uses thinkingLevel; 2.x has no such field and needs the budget set to zero instead.
    expect(classifyConfig("gemini-3.6-flash").thinkingConfig).toEqual({
      thinkingLevel: ThinkingLevel.MINIMAL,
    });
    expect(classifyConfig("gemini-2.5-flash").thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("leaves receipt scanning on the configured level", () => {
    // The one call where reasoning earns its cost. A global switch to minimal would have traded
    // scan accuracy for classifier latency.
    expect(receiptScanConfig("gemini-3.6-flash").thinkingConfig).toEqual({
      thinkingLevel: GEMINI_THINKING_LEVEL,
    });
  });

  it("asks for JSON in both, so the only difference is the thinking", () => {
    expect(classifyConfig("gemini-3.6-flash").responseMimeType).toBe("application/json");
    expect(receiptScanConfig("gemini-3.6-flash").responseMimeType).toBe("application/json");
  });
});

describe("generateContentWithRetry fallback", () => {
  it("keeps the caller's thinking intent when it switches model", async () => {
    generateContent.mockRejectedValueOnce(transient()).mockResolvedValueOnce({ text: "{}" } as never);

    // maxAttempts 1 so the primary fails straight through to the fallback with no backoff.
    await generateContentWithRetry(
      { model: "gemini-3.6-flash", contents: "hi", config: classifyConfig("gemini-3.6-flash") },
      1,
      minimalThinkingFor
    );

    expect(generateContent).toHaveBeenCalledTimes(2);
    const fallback = generateContent.mock.calls[1][0] as {
      model: string;
      config: { thinkingConfig: unknown };
    };
    expect(fallback.model).toBe(GEMINI_FALLBACK_MODEL);
    expect(fallback.config.thinkingConfig).toEqual(minimalThinkingFor(GEMINI_FALLBACK_MODEL));
  });

  it("still rebuilds from the env default when the caller passes no intent", async () => {
    // Receipt scanning relies on this, so the added parameter must not change it.
    generateContent.mockRejectedValueOnce(transient()).mockResolvedValueOnce({ text: "{}" } as never);

    await generateContentWithRetry(
      { model: "gemini-3.6-flash", contents: "hi", config: receiptScanConfig("gemini-3.6-flash") },
      1
    );

    const fallback = generateContent.mock.calls[1][0] as { config: { thinkingConfig: unknown } };
    expect(fallback.config.thinkingConfig).toEqual({ thinkingLevel: GEMINI_THINKING_LEVEL });
  });
});
