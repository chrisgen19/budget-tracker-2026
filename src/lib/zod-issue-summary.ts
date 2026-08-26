/**
 * One log-safe line describing why a payload failed validation.
 *
 * A module of its own, with no imports, because both receipt paths need it and the alternative
 * routes were both bad: `/api/receipts/breakdown` importing it from `receipt-scan.ts` would drag
 * in `gemini.ts`, which builds its client on load and throws without `GEMINI_API_KEY`, and a
 * second inline copy — which is what existed before this file — drifts the moment either the cap
 * or the format is touched.
 */

/** How many issues are named before the rest are counted. */
const MAX_LOGGED_ISSUES = 5;

/**
 * Summarize a Zod error's issues, capped.
 *
 * The cap is the point: the issue list scales with the payload, so a receipt whose every line
 * carries a zero amount yields one issue per item — up to MAX_BREAKDOWN_GROUPS x
 * MAX_BREAKDOWN_LINE_ITEMS of them — and joining all of them would put a several-hundred-KB
 * string in the log on every such scan. Five names the defect; the count carries the rest.
 */
export const summarizeIssues = (
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>
): string => {
  const shown = issues
    .slice(0, MAX_LOGGED_ISSUES)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return issues.length > MAX_LOGGED_ISSUES
    ? `${shown} (+${issues.length - MAX_LOGGED_ISSUES} more)`
    : shown;
};
