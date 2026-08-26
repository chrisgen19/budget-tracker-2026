/**
 * Words that place a transaction somewhere other than right now.
 *
 * The shorthand path is a regex that takes an amount and treats everything after it as the
 * description, then stamps the current instant. "350 groceries yesterday" therefore matched, was
 * filed under today, and carried "yesterday" in its own description as evidence of the mistake.
 * Worse, the invented timestamp then drove label auto-apply, so a Saturday errand entered on a
 * Monday morning could land inside a weekday window and be tagged as work spending.
 *
 * A message carrying any of these goes to Gemini instead, which resolves the date properly. The
 * cost of a false positive is one extra model call; the cost of a false negative is a
 * transaction on the wrong day.
 */
const TEMPORAL_HINT =
  /\b(yesterday|yday|today|tonight|tomorrow|last\s+(night|week|month|year|mon|tues|wednes|thurs|fri|satur|sun)\w*|this\s+(morning|afternoon|evening|week|month)|ago|earlier|previous|past\s+\w+|on\s+(mon|tues|wednes|thurs|fri|satur|sun)\w*|(mon|tues|wednes|thurs|fri|satur|sun)day|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}|\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i;

/**
 * Whether the fast shorthand path may handle this message.
 *
 * It may not when the text says *when* something happened, because that path has no way to
 * express a date and would silently record the current instant instead.
 */
export const isPlainShorthand = (text: string): boolean => !TEMPORAL_HINT.test(text);
