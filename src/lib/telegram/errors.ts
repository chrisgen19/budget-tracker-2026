import { isAmbiguousWriteFailure } from "@/lib/mcp/write-errors";

/**
 * A refusal the MCP server authored, as opposed to a transport or parsing failure.
 *
 * The distinction is what makes the message safe to repeat to the user. The server's text is
 * written for a model but reads well enough for a chat reply and, more importantly, is the only
 * place that says what to do next: "Writes are currently switched off for this account. Turn
 * them on in Profile > MCP Access." A network stack trace is neither.
 *
 * It also means the failure is deterministic, so there is nothing to gain by retrying it.
 */
export class McpToolError extends Error {}

/**
 * A write whose outcome is genuinely unknown.
 *
 * Raised when `create_transactions` fails at the transport level and retrying under the same
 * idempotency key could not settle it. The rows may or may not exist, and nothing the bot can
 * see will say which.
 */
export class UnconfirmedWriteError extends Error {}

/**
 * Sent when handling a message fails for a reason the server did not explain.
 *
 * Deliberately promises nothing about duplicates in either direction. It cannot say "nothing was
 * saved", because a batch can fail as `UNKNOWN_WHETHER_SAVED`. It also must not invite a resend
 * as safe: the idempotency key is derived from the Telegram *update*, so only a redelivery of the
 * same update replays. A message the user retypes arrives as a new update with a new key and
 * writes a second row, which is exactly what an over-confident reply would have caused.
 */
export const GENERIC_FAILURE_REPLY =
  "Something went wrong handling that. Please try again.";

/**
 * Sent when a write may or may not have landed.
 *
 * Says so plainly and points at the app, because checking is the only thing that resolves it.
 * Telling the user to resend would risk a duplicate; telling them nothing was saved would risk a
 * missing transaction. Naming the uncertainty is the only honest option.
 */
export const UNCONFIRMED_WRITE_REPLY =
  "I could not confirm whether that saved. Check the app before sending it again: if it is there, sending it again would add a second copy.";

/**
 * Whether a failed `create_transactions` is worth replaying under the same idempotency key.
 *
 * Everything is, except a refusal the server authored, which is deterministic and would fail
 * identically. The exception to that exception is the one that matters: `UNKNOWN_WHETHER_SAVED`
 * also arrives as an `isError`, but it is ambiguous rather than a refusal, and the server's own
 * instruction is to replay the same key. Treating every `isError` as final meant that
 * instruction was relayed to a user who cannot follow it, since a retyped message is a new
 * Telegram update with a new key and therefore a second row.
 */
export const shouldRetryWrite = (err: unknown): boolean =>
  !(err instanceof McpToolError) || isAmbiguousWriteFailure(err.message);

/**
 * What to say back when handling a message threw.
 *
 * A server refusal is repeated verbatim. The write lease is a lease, so it *will* lapse, and a
 * generic reply meant every message answered "something went wrong" forever while the actionable
 * text sat in the container log where nobody was looking.
 */
export const replyForError = (err: unknown): string => {
  if (err instanceof UnconfirmedWriteError) return UNCONFIRMED_WRITE_REPLY;
  if (err instanceof McpToolError && err.message.trim()) return err.message;
  return GENERIC_FAILURE_REPLY;
};
