/**
 * A refusal the MCP server authored, as opposed to a transport or parsing failure.
 *
 * The distinction is what makes the message safe to repeat to the user. The server's text is
 * written for a model but reads well enough for a chat reply and, more importantly, is the only
 * place that says what to do next: "Writes are currently switched off for this account. Turn
 * them on in Profile > MCP Access." A network stack trace is neither.
 */
export class McpToolError extends Error {}

/**
 * Sent when handling a message fails for a reason the server did not explain.
 *
 * It deliberately does not claim that nothing was saved. A batch can fail as
 * `UNKNOWN_WHETHER_SAVED`, where the server says outright that it cannot tell, and asserting the
 * opposite invites the user to enter the row a second time by hand. Repeating the message is
 * safe on its own: the idempotency key is derived from the Telegram update, so a resend replays
 * rather than writing again.
 */
export const GENERIC_FAILURE_REPLY =
  "Something went wrong handling that. Send it again: a repeat of the same message cannot create the transaction twice.";

/**
 * What to say back when handling a message threw.
 *
 * A server refusal is repeated verbatim. The write lease is a lease, so it *will* lapse, and a
 * generic reply meant every message answered "something went wrong" forever while the actionable
 * text sat in the container log where nobody was looking.
 */
export const replyForError = (err: unknown): string =>
  err instanceof McpToolError && err.message.trim() ? err.message : GENERIC_FAILURE_REPLY;
