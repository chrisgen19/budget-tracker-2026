import { describe, expect, it } from "vitest";
import { resolveCommand } from "@/lib/telegram/commands";

describe("resolveCommand", () => {
  it("resolves the slash commands", () => {
    expect(resolveCommand("/summary")).toBe("SUMMARY");
    expect(resolveCommand("/balance")).toBe("SUMMARY");
    expect(resolveCommand("/recent")).toBe("RECENT");
    expect(resolveCommand("/bills")).toBe("BILLS");
    expect(resolveCommand("/categories")).toBe("CATEGORIES");
    expect(resolveCommand("/help")).toBe("HELP");
    expect(resolveCommand("/start")).toBe("HELP");
  });

  it("tolerates the @botname Telegram appends in shared chats", () => {
    expect(resolveCommand("/summary@budget0719_bot")).toBe("SUMMARY");
  });

  // The point of the change: recognising the word "summary" should not cost a model call, and
  // should keep working when GEMINI_API_KEY is unset, where free text gets "I couldn't
  // understand that command" instead.
  it("resolves bare words without the slash", () => {
    expect(resolveCommand("summary")).toBe("SUMMARY");
    expect(resolveCommand("balance")).toBe("SUMMARY");
    expect(resolveCommand("recent")).toBe("RECENT");
    expect(resolveCommand("bills")).toBe("BILLS");
    expect(resolveCommand("categories")).toBe("CATEGORIES");
    expect(resolveCommand("help")).toBe("HELP");
  });

  it("resolves the obvious polite phrasings", () => {
    for (const text of ["give summary", "show me the summary", "get my balance", "summary please"]) {
      expect(resolveCommand(text), text).toBe("SUMMARY");
    }
    expect(resolveCommand("show recent transactions")).toBe("RECENT");
    expect(resolveCommand("list my bills")).toBe("BILLS");
    expect(resolveCommand("show categories")).toBe("CATEGORIES");
  });

  it("accepts an article without a verb, which is how people actually type", () => {
    expect(resolveCommand("my balance")).toBe("SUMMARY");
    expect(resolveCommand("my bills please")).toBe("BILLS");
    expect(resolveCommand("the categories")).toBe("CATEGORIES");
    expect(resolveCommand("check my balance")).toBe("SUMMARY");
  });

  it("ignores case and trailing punctuation", () => {
    expect(resolveCommand("  Summary?  ")).toBe("SUMMARY");
    expect(resolveCommand("BILLS!")).toBe("BILLS");
  });

  // Everything below must fall through, because a wrong local guess answers a question the user
  // did not ask and gives no sign it misread them. Gemini is the right place for ambiguity.
  it("leaves anything that logs a transaction alone", () => {
    for (const text of ["100 breakfast", "+5000 salary", "1500 internet bill", "350 groceries yesterday"]) {
      expect(resolveCommand(text), text).toBeNull();
    }
  });

  it("leaves conversational questions to the model", () => {
    for (const text of [
      "how much did I spend this month",
      "what did I buy yesterday",
      "am I over budget",
      "summarise my food spending",
    ]) {
      expect(resolveCommand(text), text).toBeNull();
    }
  });

  it("does not fire on a word that merely contains a command", () => {
    for (const text of ["summarypaper", "billy", "categorically", "recently bought milk"]) {
      expect(resolveCommand(text), text).toBeNull();
    }
  });

  it("does not treat an unknown slash command as a command", () => {
    expect(resolveCommand("/delete")).toBeNull();
    expect(resolveCommand("/settings")).toBeNull();
  });

  it("returns null for an empty message", () => {
    expect(resolveCommand("")).toBeNull();
    expect(resolveCommand("   ")).toBeNull();
  });
});
