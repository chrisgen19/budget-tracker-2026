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
  /**
   * The documented support matrix, per https://ai.google.dev/gemini-api/docs/thinking.
   *
   * The capability varies *within* a generation, which is the whole reason this is not a simple
   * 3.x/2.x branch: `gemini-3.7-flash` is a Flash model that does not accept `minimal`, and
   * `gemini-2.5-pro` cannot disable thinking at all (its range starts at 128).
   *
   * An unsupported value is a 400. `classifyMessage` catches it and returns null, so it reaches
   * the user as "I couldn't understand that command" on every free-text message — which is why
   * the fallback is `low` (present in every 3.x row) rather than anything cleverer.
   */
  it.each([
    // 3.x — thinkingLevel
    ["gemini-3.6-flash", { thinkingLevel: ThinkingLevel.MINIMAL }],
    ["gemini-3.5-flash", { thinkingLevel: ThinkingLevel.MINIMAL }],
    ["gemini-3.5-flash-lite", { thinkingLevel: ThinkingLevel.MINIMAL }],
    // No `minimal` in the docs for these three, so they must degrade rather than 400.
    ["gemini-3.7-flash", { thinkingLevel: ThinkingLevel.LOW }],
    ["gemini-3.1-pro-preview", { thinkingLevel: ThinkingLevel.LOW }],
    ["gemini-3-pro-preview", { thinkingLevel: ThinkingLevel.LOW }],
    // 2.x — thinkingBudget. Sending both knobs at once is a 400, hence one or the other.
    ["gemini-2.5-flash", { thinkingBudget: 0 }],
    ["gemini-2.5-flash-lite", { thinkingBudget: 0 }],
    ["gemini-2.5-pro", { thinkingBudget: 128 }],
  ])("asks %s for the cheapest thinking it actually supports", (model, expected) => {
    expect(minimalThinkingFor(model as string)).toEqual(expected);
    expect(classifyConfig(model as string).thinkingConfig).toEqual(expected);
  });

  it.each([
    ["models/gemini-2.5-flash", { thinkingBudget: 0 }],
    ["models/gemini-2.5-pro", { thinkingBudget: 128 }],
    ["models/gemini-3.6-flash", { thinkingLevel: ThinkingLevel.MINIMAL }],
    ["models/gemini-3.7-flash", { thinkingLevel: ThinkingLevel.LOW }],
  ])("reads the generation through the resource prefix on %s", (model, expected) => {
    // The SDK accepts both `gemini-2.5-flash` and `models/gemini-2.5-flash` and passes the
    // prefixed form through untouched, so both can arrive from GEMINI_MODEL. Testing the raw
    // string read the prefixed form as generation-less and sent thinkingLevel to a 2.x model,
    // which is a non-retryable 400.
    expect(minimalThinkingFor(model as string)).toEqual(expected);
  });

  it("treats a generation-less alias as a current-generation model", () => {
    // `gemini-flash-latest` and friends hot-swap and name no generation, so the knob cannot be
    // derived from the string. thinkingLevel is the forward-correct guess: it is what every
    // current and future model takes, and the alias that once pointed at a 2.x model now
    // resolves to a 3.x one. `low` keeps it inside what every 3.x model supports.
    expect(minimalThinkingFor("gemini-flash-latest")).toEqual({
      thinkingLevel: ThinkingLevel.LOW,
    });
  });

  it("never asks an unknown model for a level outside the universal set", () => {
    // A model shipped after this code was written is the case that matters — that is how #163
    // happened. `low` and a 128 budget are both accepted by every model in the table above.
    expect(classifyConfig("gemini-9.9-flash-experimental").thinkingConfig).toEqual({
      thinkingLevel: ThinkingLevel.LOW,
    });
    expect(classifyConfig("gemini-2.9-pro-experimental").thinkingConfig).toEqual({
      thinkingBudget: 128,
    });
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
