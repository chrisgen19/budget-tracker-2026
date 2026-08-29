/**
 * Drives the real Gemini classifier for the phrasings the day-range work exists to serve.
 *
 * Deliberately not a unit test: the thing being checked is whether the *prompt* gets a model to
 * emit `from`/`to` for a period narrower than a month, and a stubbed model proves nothing about
 * that. Costs one Gemini call per phrasing.
 */
import { classifyMessage, GEMINI_ENABLED } from "../src/lib/telegram/classify";
import { parseSearchIntent } from "../src/lib/telegram/search-intent";
import { describeWindow } from "../src/lib/telegram/period-label";

const MANILA = -480;

const CATEGORIES = [
  { id: "c-food", name: "Food & Dining", type: "EXPENSE" },
  { id: "c-transport", name: "Transportation", type: "EXPENSE" },
  { id: "c-fun", name: "Fun", type: "EXPENSE" },
];
const LABELS = [
  { id: "l-work", name: "Work Budget" },
  { id: "l-family", name: "Family Budget" },
];

type Expectation = "RANGE" | "MONTH" | "NO_PERIOD";

const CASES: Array<{ text: string; expect: Expectation }> = [
  { text: "how much did I spend on transportation last week", expect: "RANGE" },
  { text: "what did I spend on food yesterday", expect: "RANGE" },
  { text: "how much on transportation in the last 3 days", expect: "RANGE" },
  { text: "how much did I spend on food this month", expect: "MONTH" },
  { text: "how much have I spent on transportation", expect: "NO_PERIOD" },
];

let failures = 0;

const classifyOf = (intent: ReturnType<typeof parseSearchIntent>): Expectation | "NOT_SEARCH" => {
  if (!intent || intent.kind !== "SEARCH") return "NOT_SEARCH";
  if (intent.from || intent.to) return "RANGE";
  if (intent.month) return "MONTH";
  return "NO_PERIOD";
};

const main = async () => {
  if (!GEMINI_ENABLED) {
    console.error("GEMINI_API_KEY is not set; this script needs a real model call.");
    process.exit(1);
  }

  const today = new Date(Date.now() - MANILA * 60_000).toISOString().slice(0, 10);
  console.log(`today in the user's zone: ${today}\n`);

  for (const testCase of CASES) {
    const raw = await classifyMessage(testCase.text, CATEGORIES, LABELS, MANILA);
    const intent = parseSearchIntent(raw, { labels: LABELS, categories: CATEGORIES });
    const got = classifyOf(intent);
    const ok = got === testCase.expect;
    if (!ok) failures++;

    const window =
      intent && intent.kind === "SEARCH"
        ? describeWindow({ month: intent.month, from: intent.from, to: intent.to }) || " (all time)"
        : " -";

    console.log(`${ok ? "PASS" : "FAIL"}  "${testCase.text}"`);
    console.log(`        expected ${testCase.expect}, got ${got}`);
    console.log(`        reply would say:${window}`);
    if (intent && intent.kind === "SEARCH") {
      console.log(
        `        subject="${intent.subject}" label=${intent.labelId ?? "-"} category=${intent.categoryId ?? "-"}`
      );
    }
    console.log();
  }

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
