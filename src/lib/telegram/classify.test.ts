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

/**
 * Controlled per test rather than inherited from the environment.
 *
 * `GEMINI_TIMEOUT_MS=0` is a supported configuration ("0 disables"), and reading the real one
 * meant the timeout assertion below crashed with a TypeError on any machine that set it,
 * rather than testing the branch. A getter, because the value is read per call inside
 * `classifyMessage`, not captured at module scope.
 */
let timeoutMs = 60_000;
vi.mock("@/lib/gemini-limits", () => ({
  get GEMINI_TIMEOUT_MS() {
    return timeoutMs;
  },
}));

vi.mock("@/lib/gemini", () => ({
  GEMINI_MODEL: "configured-model",
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
  timeoutMs = 60_000;
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

  it("still bounds each attempt, which the wrapper does not do for it", async () => {
    // `generateContentWithRetry` adds retries and a fallback model but no timeout of its own, so
    // dropping this would leave every attempt unbounded — and the poll loop awaits each update in
    // turn, so one unbounded call stops the bot answering anyone.
    timeoutMs = 45_000;
    generateContentWithRetry.mockResolvedValue(reply({ action: "SHOW_SUMMARY" }));
    const { classifyMessage } = await loadClassify("key");

    await classifyMessage("summary", CATEGORIES, LABELS, -480);

    const { config } = generateContentWithRetry.mock.calls[0][0];
    expect(config.responseMimeType).toBe("application/json");
    expect(config.httpOptions).toEqual({ timeout: 45_000 });
  });

  it("omits httpOptions entirely when the timeout is disabled", async () => {
    // GEMINI_TIMEOUT_MS=0 is supported and documented as "0 disables". Passing
    // `httpOptions: { timeout: 0 }` is not the same thing as passing nothing.
    timeoutMs = 0;
    generateContentWithRetry.mockResolvedValue(reply({ action: "SHOW_SUMMARY" }));
    const { classifyMessage } = await loadClassify("key");

    await classifyMessage("summary", CATEGORIES, LABELS, -480);

    const { config } = generateContentWithRetry.mock.calls[0][0];
    expect(config.responseMimeType).toBe("application/json");
    expect(config.httpOptions).toBeUndefined();
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
