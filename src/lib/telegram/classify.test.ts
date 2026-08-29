import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What #163 cost, pinned so it cannot come back.
 *
 * The classifier pinned `gemini-2.5-flash` as a literal while every other caller imported
 * `GEMINI_MODEL`, and it called the SDK directly rather than the retry wrapper. Neither failed
 * loudly: the wrong model degrades as misrouted intent, and a swallowed 503 reaches the user as
 * "I couldn't understand that command", so they rephrase a message that was already fine.
 *
 * These assert the seam rather than the prompt. The prompt is expected to change; which model it
 * runs on, and whether a transient failure is retried, are not.
 */

const generateContentWithRetry = vi.fn();

vi.mock("@/lib/gemini-limits", () => ({ GEMINI_MAX_ATTEMPTS: 3 }));

/** Stand-ins for the two helpers classify.ts must reach for. What they *return* is gemini.ts's
 *  business and is covered in gemini.test.ts; what matters here is that this call site uses them
 *  rather than hand-rolling a config, which is how the thinking level drifts in the first place. */
const CLASSIFY_CONFIG = { responseMimeType: "application/json", thinkingConfig: "MINIMAL-SENTINEL" };
const minimalThinkingFor = vi.fn(() => ({ thinkingLevel: "MINIMAL" }));

vi.mock("@/lib/gemini", () => ({
  GEMINI_MODEL: "configured-model",
  classifyConfig: () => CLASSIFY_CONFIG,
  minimalThinkingFor,
  generateContentWithRetry: (...args: unknown[]) => generateContentWithRetry(...args),
}));

const CATEGORIES = [{ id: "cat_food", name: "Food & Dining", type: "EXPENSE" }];
const LABELS = [{ id: "lbl_work", name: "Work" }];

/** Re-imported per test: GEMINI_ENABLED is read from the environment at module load. */
const loadClassify = async (apiKey: string) => {
  vi.stubEnv("GEMINI_API_KEY", apiKey);
  vi.resetModules();
  return import("@/lib/telegram/classify");
};

const reply = (payload: unknown) => ({ text: JSON.stringify(payload) });

beforeEach(() => {
  generateContentWithRetry.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("classifyMessage", () => {
  it("runs the configured model, never a pinned literal", async () => {
    generateContentWithRetry.mockResolvedValue(reply({ action: "SHOW_SUMMARY" }));
    const { classifyMessage } = await loadClassify("key");

    await classifyMessage("how am I doing", CATEGORIES, LABELS, -480);

    expect(generateContentWithRetry).toHaveBeenCalledTimes(1);
    expect(generateContentWithRetry.mock.calls[0][0].model).toBe("configured-model");
  });

  it("goes through the retry wrapper, so a transient failure is not the user's problem", async () => {
    // The wrapper owns the 3 primary attempts plus the fallback model. Calling the SDK directly
    // meant one attempt, and a 503 became "I couldn't understand that command".
    generateContentWithRetry.mockResolvedValue(reply({ action: "SHOW_RECENT" }));
    const { classifyMessage } = await loadClassify("key");

    const result = await classifyMessage("what did I log", CATEGORIES, LABELS, -480);

    expect(result).toEqual({ action: "SHOW_RECENT" });
    expect(generateContentWithRetry).toHaveBeenCalled();
  });

  it("asks for minimal thinking, unlike the receipt scanner", async () => {
    // Classification picks one of eleven labels from a prompt that lists them. Running it at the
    // model's default cost latency on the hot path of every free-text message and bought nothing
    // (#163 Phase 2). Receipt scanning keeps the configured level; these must not share a knob.
    generateContentWithRetry.mockResolvedValue(reply({ action: "SHOW_SUMMARY" }));
    const { classifyMessage } = await loadClassify("key");

    await classifyMessage("summary", CATEGORIES, LABELS, -480);

    expect(generateContentWithRetry.mock.calls[0][0].config).toBe(CLASSIFY_CONFIG);
  });

  it("carries the minimal-thinking intent into the fallback model", async () => {
    // The fallback path rebuilds thinkingConfig for whichever model it switches to. Passing
    // nothing let it rebuild from GEMINI_THINKING_LEVEL, silently restoring `medium` mid-retry.
    generateContentWithRetry.mockResolvedValue(reply({ action: "SHOW_SUMMARY" }));
    const { classifyMessage } = await loadClassify("key");

    await classifyMessage("summary", CATEGORIES, LABELS, -480);

    expect(generateContentWithRetry.mock.calls[0][2]).toBe(minimalThinkingFor);
  });

  it("resolves 'now' against the caller's timezone, not the host's", async () => {
    // The offset used to be read from bot.ts module scope. Passing it in is what lets the app
    // container run UTC while the prompt still says Manila.
    generateContentWithRetry.mockResolvedValue(reply({ action: "UNSUPPORTED" }));
    const { classifyMessage } = await loadClassify("key");
    const at = new Date("2026-08-29T16:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(at);

    await classifyMessage("hello", CATEGORIES, LABELS, -480);
    vi.useRealTimers();

    // UTC+8, so 16:00Z is the 30th locally. A UTC host would have said the 29th.
    expect(generateContentWithRetry.mock.calls[0][0].contents).toContain("2026-08-30T00:00:00");
  });

  it("hands the model label and category names, never ids alone", async () => {
    generateContentWithRetry.mockResolvedValue(reply({ action: "UNSUPPORTED" }));
    const { classifyMessage } = await loadClassify("key");

    await classifyMessage("did I spend on work", CATEGORIES, LABELS, -480);

    const prompt = generateContentWithRetry.mock.calls[0][0].contents;
    expect(prompt).toContain("Work");
    expect(prompt).toContain("Food & Dining");
  });

  it("returns null without an API key, and never constructs a client", async () => {
    // The bot branches on GEMINI_ENABLED to fall back to shorthand-only logging. Importing the
    // client eagerly would throw at boot instead, since it is built at module scope.
    const { classifyMessage, GEMINI_ENABLED } = await loadClassify("");

    expect(GEMINI_ENABLED).toBe(false);
    await expect(classifyMessage("100 breakfast", CATEGORIES, LABELS, -480)).resolves.toBeNull();
    expect(generateContentWithRetry).not.toHaveBeenCalled();
  });

  it("returns null when the call ultimately fails, so the caller can fall through", async () => {
    generateContentWithRetry.mockRejectedValue(new Error("still overloaded"));
    const { classifyMessage } = await loadClassify("key");

    await expect(classifyMessage("summary", CATEGORIES, LABELS, -480)).resolves.toBeNull();
  });
});
