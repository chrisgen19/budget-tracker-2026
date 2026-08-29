import { describe, expect, it } from "vitest";
import { callbackIsAllowed, messageIsAllowed, type TelegramMessage } from "@/lib/telegram/allowlist";

const LIST = { ids: new Set(["12345"]), usernames: new Set(["chrisgen19"]) };
const EMPTY = { ids: new Set<string>(), usernames: new Set<string>() };

const message = (over: Partial<TelegramMessage> = {}): TelegramMessage => ({
  chat: { id: 1, type: "private" },
  from: { id: 12345 },
  text: "100 lunch",
  ...over,
});

describe("messageIsAllowed", () => {
  it("accepts an allowlisted id in a private chat", () => {
    expect(messageIsAllowed(message(), LIST)).toBe(true);
  });

  it("accepts an allowlisted username case-insensitively", () => {
    expect(messageIsAllowed(message({ from: { username: "ChrisGen19" } }), LIST)).toBe(true);
  });

  it("denies a sender who is on neither list", () => {
    expect(messageIsAllowed(message({ from: { id: 999, username: "stranger" } }), LIST)).toBe(false);
  });

  it("denies everyone when the allowlist is empty", () => {
    expect(messageIsAllowed(message(), EMPTY)).toBe(false);
  });

  it("denies a message with no sender", () => {
    expect(messageIsAllowed(message({ from: undefined }), LIST)).toBe(false);
  });

  // The bug this covers: the gate authenticated the sender only, and replies go to
  // `message.chat.id`. The owner running /summary in a group would have shown their balance and
  // recent spending to every member of it.
  it("denies an allowlisted sender in a group, where the reply would be public", () => {
    expect(messageIsAllowed(message({ chat: { id: -100, type: "group" } }), LIST)).toBe(false);
    expect(messageIsAllowed(message({ chat: { id: -100, type: "supergroup" } }), LIST)).toBe(false);
    expect(messageIsAllowed(message({ chat: { id: -100, type: "channel" } }), LIST)).toBe(false);
  });

  it("denies a chat whose type is missing, rather than assuming it is private", () => {
    expect(messageIsAllowed(message({ chat: { id: 1 } }), LIST)).toBe(false);
  });

  it("denies an undefined message", () => {
    expect(messageIsAllowed(undefined, LIST)).toBe(false);
  });
});

describe("callbackIsAllowed", () => {
  const query = (over: Record<string, unknown> = {}) => ({
    id: "cb1",
    from: { id: 42, username: "owner" },
    message: { chat: { id: 42, type: "private" }, message_id: 9 },
    data: "rs:y:1",
    ...over,
  });

  it("allows an allowlisted sender in a private chat", () => {
    expect(callbackIsAllowed(query(), { ids: new Set(["42"]), usernames: new Set() })).toBe(true);
  });

  it("denies a stranger who taps a forwarded review", () => {
    // The message was sent to the owner; the press arrives from whoever tapped it. Authenticating
    // the press rather than the original message is the whole point.
    expect(
      callbackIsAllowed(query({ from: { id: 999, username: "stranger" } }), {
        ids: new Set(["42"]),
        usernames: new Set(),
      })
    ).toBe(false);
  });

  it("denies a press outside a private chat", () => {
    expect(
      callbackIsAllowed(query({ message: { chat: { id: -100, type: "group" }, message_id: 9 } }), {
        ids: new Set(["42"]),
        usernames: new Set(),
      })
    ).toBe(false);
  });

  it("denies when the payload is missing pieces, rather than guessing", () => {
    const list = { ids: new Set(["42"]), usernames: new Set<string>() };
    expect(callbackIsAllowed(undefined, list)).toBe(false);
    expect(callbackIsAllowed(query({ from: undefined }), list)).toBe(false);
    expect(callbackIsAllowed(query({ message: undefined }), list)).toBe(false);
    expect(callbackIsAllowed(query({ message: { message_id: 9 } }), list)).toBe(false);
  });

  it("denies everyone when the allowlist is empty", () => {
    expect(callbackIsAllowed(query(), { ids: new Set(), usernames: new Set() })).toBe(false);
  });
});
