import { describe, expect, it } from "vitest";
import {
  GENERIC_FAILURE_REPLY,
  McpToolError,
  UNCONFIRMED_WRITE_REPLY,
  UnconfirmedWriteError,
  replyForError,
} from "@/lib/telegram/errors";

describe("replyForError", () => {
  // The bug this covers: callTool throws the server's own message, and the only consumer
  // discarded it for a fixed string. The write lease is a lease, so once it lapses every message
  // answered "something went wrong" forever while the fix sat in the container log.
  it("repeats a server refusal, which is the only text saying what to do next", () => {
    const err = new McpToolError(
      "Writes are currently switched off for this account. Turn them on in Profile > MCP Access, then try again."
    );
    expect(replyForError(err)).toContain("Profile > MCP Access");
  });

  it("repeats a missing-scope refusal too", () => {
    const err = new McpToolError("This token cannot create transactions.");
    expect(replyForError(err)).toBe("This token cannot create transactions.");
  });

  it("does not repeat a transport failure, which is noise in a chat", () => {
    expect(replyForError(new Error("fetch failed"))).toBe(GENERIC_FAILURE_REPLY);
    expect(replyForError(new TypeError("undefined is not an object"))).toBe(GENERIC_FAILURE_REPLY);
  });

  it("falls back when the server sent an empty message", () => {
    expect(replyForError(new McpToolError("   "))).toBe(GENERIC_FAILURE_REPLY);
  });

  it("handles a thrown non-error", () => {
    expect(replyForError("boom")).toBe(GENERIC_FAILURE_REPLY);
    expect(replyForError(undefined)).toBe(GENERIC_FAILURE_REPLY);
  });

  // A batch can fail as UNKNOWN_WHETHER_SAVED, where the server says it cannot tell whether rows
  // were written. Telling the user nothing was saved invites a duplicate entered by hand.
  it("never claims nothing was saved", () => {
    expect(GENERIC_FAILURE_REPLY.toLowerCase()).not.toContain("nothing was saved");
  });

  it("names an unconfirmed write instead of inviting a resend", () => {
    expect(replyForError(new UnconfirmedWriteError("batch x unresolved"))).toBe(
      UNCONFIRMED_WRITE_REPLY
    );
  });

  // The bug this covers: the generic reply told the user "send it again: a repeat cannot create
  // the transaction twice". The key is derived from the Telegram *update*, so only a redelivery
  // replays. A retyped message is a new update with a new key, so that advice caused the very
  // duplicate it promised to prevent.
  it("never tells the user a resend cannot duplicate", () => {
    for (const reply of [GENERIC_FAILURE_REPLY, UNCONFIRMED_WRITE_REPLY]) {
      expect(reply.toLowerCase()).not.toMatch(/cannot create the transaction twice|cannot duplicate/);
    }
  });

  it("warns that a resend would duplicate when the write is unconfirmed", () => {
    expect(UNCONFIRMED_WRITE_REPLY.toLowerCase()).toContain("second copy");
  });
});
