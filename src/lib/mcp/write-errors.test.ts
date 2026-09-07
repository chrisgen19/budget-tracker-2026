import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBudgetMcpServer } from "./server";
import {
  BILL_ACTION_ERROR_MESSAGES,
  BILL_WRITE_ERROR_MESSAGES,
  LABEL_WRITE_ERROR_MESSAGES,
  WRITE_ERROR_MESSAGES,
  isAmbiguousWriteFailure,
} from "./write-errors";
import type { PrismaClient } from "../budget-query-types";

/**
 * The Telegram bot decides whether to replay a batch by recognising the server's own text.
 *
 * That coupling is deliberate (see write-errors.ts) but it is only safe if it is pinned: if the
 * tool's wording drifts from the table, the bot silently stops replaying and starts telling the
 * user to resend, which is how duplicates get written.
 */

/** A Prisma stub whose keyed write path fails, producing UNKNOWN_WHETHER_SAVED. */
const makeFailingPrisma = () => {
  const client = {
    category: { findMany: vi.fn(async () => [{ id: "cat_1", type: "EXPENSE" }]) },
    label: { findMany: vi.fn(async () => []) },
    user: {
      findUnique: vi.fn(async () => ({ mcpWritesEnabledUntil: new Date(Date.now() + 60_000) })),
    },
    transaction: {
      create: vi.fn(async () => {
        throw new Error("connection lost mid-write");
      }),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(client)
    ),
    $executeRaw: vi.fn(async () => 1),
  };
  return client as unknown as PrismaClient;
};

const callCreate = async (prisma: PrismaClient): Promise<string> => {
  const server = createBudgetMcpServer({
    prisma,
    userId: "user_1",
    timezoneOffset: -480,
    scopes: ["transactions:write"],
    writesEnabledUntil: new Date(Date.now() + 60_000),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const res = await client.callTool({
    name: "create_transactions",
    arguments: {
      clientBatchId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
      transactions: [
        {
          amount: 100,
          description: "Lunch",
          type: "EXPENSE",
          date: "2026-08-25",
          categoryId: "cat_1",
          labelIds: [],
        },
      ],
    },
  });
  await client.close();

  return (res.content as { text?: string }[])[0]?.text ?? "";
};

describe("write error messages", () => {
  it("emits text the bot recognises as ambiguous when a keyed write fails", async () => {
    const text = await callCreate(makeFailingPrisma());

    expect(text).toBe(WRITE_ERROR_MESSAGES.UNKNOWN_WHETHER_SAVED);
    // The bug this covers: the bot classified every isError as a deterministic refusal and
    // skipped its same-key retry, then relayed "retry with the same clientBatchId" to a user who
    // has no way to do that. Retyping makes a new update, a new key, and a second row.
    expect(isAmbiguousWriteFailure(text)).toBe(true);
  });

  it("does not treat a deterministic refusal as ambiguous", () => {
    expect(isAmbiguousWriteFailure(WRITE_ERROR_MESSAGES.LABELS_NOT_OWNED)).toBe(false);
    expect(isAmbiguousWriteFailure(WRITE_ERROR_MESSAGES.CATEGORIES_NOT_OWNED)).toBe(false);
    expect(isAmbiguousWriteFailure(WRITE_ERROR_MESSAGES.NO_LONGER_PERMITTED)).toBe(false);
    expect(isAmbiguousWriteFailure("This token cannot create transactions.")).toBe(false);
  });

  // NO_LONGER_PERMITTED used to share the "could not confirm" wording. That check runs inside
  // the transaction before any row is created, so nothing was written: saying it might have been
  // sends the caller looking for rows that do not exist.
  it("says plainly that a lapsed lease wrote nothing", () => {
    expect(WRITE_ERROR_MESSAGES.NO_LONGER_PERMITTED).toContain("nothing was written");
    expect(WRITE_ERROR_MESSAGES.NO_LONGER_PERMITTED).not.toContain("Could not confirm");
  });
});

describe("bill and label write messages", () => {
  /**
   * None of these leaves the outcome unknown.
   *
   * Every bill and label failure is decided before or inside the same transaction as the write, so
   * unlike a keyed create there is nothing to replay and nothing to go looking for. The bot's
   * classifier keys on the create table's exact wording, so any of these being mistaken for it
   * would send it into a same-key retry it has no key for.
   */
  it("never reads as ambiguous", () => {
    for (const message of [
      ...Object.values(BILL_ACTION_ERROR_MESSAGES),
      ...Object.values(BILL_WRITE_ERROR_MESSAGES),
      ...Object.values(LABEL_WRITE_ERROR_MESSAGES),
    ]) {
      expect(isAmbiguousWriteFailure(message)).toBe(false);
    }
  });

  it("says what was changed, which is nothing, in every case", () => {
    for (const message of [
      ...Object.values(BILL_ACTION_ERROR_MESSAGES),
      ...Object.values(BILL_WRITE_ERROR_MESSAGES),
      ...Object.values(LABEL_WRITE_ERROR_MESSAGES),
    ]) {
      expect(message.toLowerCase()).toMatch(/nothing was (changed|created)/);
    }
  });

  /**
   * The one that has to read as "already done", not "failed".
   *
   * A model told a write failed retries it. Here the work is complete and the retry is the
   * mistake: the occurrence carries a terminal log, and only the lock and this guard stand between
   * a resubmit and paying the same month twice.
   */
  it("tells the caller not to retry an occurrence that is already settled", () => {
    expect(BILL_ACTION_ERROR_MESSAGES.ALREADY_SETTLED).toContain("Do not retry");
  });

  /** A variable bill's stored amount is a forecast. The message has to name the missing field, or
   *  the model retries the identical call. */
  it("names the field that would make a variable bill's payment succeed", () => {
    expect(BILL_ACTION_ERROR_MESSAGES.AMOUNT_REQUIRED).toContain("`amount`");
  });

  /** The likeliest cause is not a bad id but a bare `type` flip that left the category behind. */
  it("points a category refusal at the type mismatch rather than the id", () => {
    expect(BILL_WRITE_ERROR_MESSAGES.CATEGORY_NOT_USABLE).toContain("type");
  });
});
