/**
 * Telegram's hard limit on `sendMessage` text. A longer message is rejected outright with
 * "message is too long", not truncated.
 */
export const TELEGRAM_MAX_TEXT = 4096;

/**
 * Split a reply into pieces Telegram will accept.
 *
 * Without this a long reply failed every send attempt, including the plain-text fallback, which
 * is the same length. The caller then acknowledged the update having sent nothing, so the user
 * got silence rather than an error. `/categories` is the reachable case: the list is unbounded
 * and names can be long.
 *
 * Splits on line boundaries so the pieces stay readable and, more practically, so a Markdown
 * entity is never cut in half: nothing this bot emits spans a newline, so a break there cannot
 * leave an unclosed `*`. A single line longer than the limit is hard-split, since there is
 * nothing better to do with it.
 */
export const chunkMessage = (text: string, limit = TELEGRAM_MAX_TEXT): string[] => {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = "";

  const push = () => {
    if (current) chunks.push(current);
    current = "";
  };

  for (const line of text.split("\n")) {
    // A line that cannot fit on its own is broken up directly.
    if (line.length > limit) {
      push();
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }

    // +1 for the newline that rejoins it.
    if (current && current.length + line.length + 1 > limit) push();
    current = current ? `${current}\n${line}` : line;
  }

  push();
  return chunks;
};
