import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBudgetMcpServer } from "./server";
import { WRITE_ERROR_MESSAGES, isAmbiguousWriteFailure } from "./write-errors";
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
