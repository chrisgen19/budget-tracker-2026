import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBudgetMcpServer } from "./server";
import { MCP_TOOL_SCOPES, READ_ONLY_SCOPES, type McpScope } from "./scopes";
import type { PrismaClient } from "../budget-query-types";

/** Registration never touches the database (only the tool handlers do, and none are called
 *  here). A stub keeps the test free of a live Postgres. */
const prisma = {} as PrismaClient;

const listToolNames = async (scopes?: readonly McpScope[]) => {
  const server = createBudgetMcpServer({ prisma, userId: "user_1", timezoneOffset: -480, scopes });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();

  return tools.map((tool) => tool.name).sort();
};

/**
 * A Prisma stub for the write path, recording what `create_transactions` asked to be written.
 *
 * Only the handful of calls the create path makes are stubbed; the read tools are never invoked
 * from here.
 */
const makeWritePrisma = () => {
  const created: Record<string, unknown>[] = [];
  const client = {
    category: {
      findMany: vi.fn(async () => [{ id: "cat_1", type: "EXPENSE" }]),
    },
    label: { findMany: vi.fn(async () => []) },
    // Read by the in-transaction lease re-check, which runs immediately before any row is written.
    user: {
      findUnique: vi.fn(async () => ({ mcpWritesEnabledUntil: new Date(Date.now() + 60_000) })),
    },
    transaction: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return {
          id: `tx_${created.length}`,
          ...data,
          category: { id: "cat_1", name: "Food", type: "EXPENSE", icon: null, color: null },
          labels: [],
        };
      }),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(client)
    ),
    $executeRaw: vi.fn(async () => 1),
  };
  return { client: client as unknown as PrismaClient, created };
};

/** Calls `create_transactions` over a real in-memory client/server pair. */
const callCreate = async (options: Parameters<typeof createBudgetMcpServer>[0]) => {
  const server = createBudgetMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  await client.callTool({
    name: "create_transactions",
    arguments: {
      clientBatchId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
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
};

describe("create_transactions provenance", () => {
  /**
   * Provenance belongs to the credential, not the endpoint.
   *
   * Every remote write arrives through `/api/mcp`, so a hardcoded "MCP" made the Telegram bot's
   * rows claim Claude wrote them. The tool must stamp whatever the token said it was.
   */
  it("stamps the source the server was configured with", async () => {
    const { client, created } = makeWritePrisma();

    await callCreate({
      prisma: client,
      userId: "user_1",
      timezoneOffset: -480,
      scopes: ["transactions:write"],
      writesEnabledUntil: new Date(Date.now() + 60_000),
      tokenId: "tok_telegram",
      createdVia: "TELEGRAM",
    });

    expect(created).toHaveLength(1);
    expect(created[0].createdVia).toBe("TELEGRAM");
    expect(created[0].mcpTokenId).toBe("tok_telegram");
  });

  it("defaults to MCP when no source is given, so an existing token keeps its meaning", async () => {
    const { client, created } = makeWritePrisma();

    await callCreate({
      prisma: client,
      userId: "user_1",
      timezoneOffset: -480,
      scopes: ["transactions:write"],
      writesEnabledUntil: new Date(Date.now() + 60_000),
      tokenId: "tok_claude",
    });

    expect(created[0].createdVia).toBe("MCP");
  });
});

describe("createBudgetMcpServer", () => {
  it("serves every read tool, and no write tool, when no scopes are given", async () => {
    // The stdio entry point does not pass scopes and supplies no write lease, so defaulting to
    // every scope would advertise a tool guaranteed to fail and point the user at a remote
    // setting that does not apply to a locally spawned server.
    const names = await listToolNames();

    expect(names).toEqual(
      Object.entries(MCP_TOOL_SCOPES)
        .filter(([, scope]) => READ_ONLY_SCOPES.includes(scope))
        .map(([name]) => name)
        .sort()
    );
    expect(names).not.toContain("create_transactions");
  });

  it("never exposes the write tool to a read-only token", async () => {
    const names = await listToolNames(["budget:read", "transactions:read", "receipts:read"]);
    expect(names).not.toContain("create_transactions");
  });

  it("exposes the write tool only with transactions:write", async () => {
    expect(await listToolNames(["transactions:write"])).toEqual(["create_transactions"]);
  });

  it("removes tools outside the granted scopes rather than leaving them listed", async () => {
    const names = await listToolNames(["bills:read"]);

    expect(names).toEqual(["get_bill_history", "get_upcoming_bills"]);
    // The point of removal over a call-time rejection: a scoped token must not advertise
    // capabilities it cannot use.
    expect(names).not.toContain("get_receipt_items");
  });

  it("grants nothing when no scope is granted", async () => {
    expect(await listToolNames([])).toEqual([]);
  });

  it("declares every registered tool in the scope map", async () => {
    // A tool added to server.ts without a MCP_TOOL_SCOPES entry would be removed from every
    // token. Catch that here rather than in a client that silently cannot see it.
    const registered = await listToolNames(Object.values(MCP_TOOL_SCOPES));
    const mapped = Object.keys(MCP_TOOL_SCOPES).sort();

    expect(registered).toEqual(mapped);
  });

  it("keeps every read tool read-only and marks the write tool as not", async () => {
    const server = createBudgetMcpServer({
      prisma,
      userId: "user_1",
      timezoneOffset: -480,
      scopes: Object.values(MCP_TOOL_SCOPES),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    await client.close();

    expect(tools).toHaveLength(Object.keys(MCP_TOOL_SCOPES).length);

    const readTools = tools.filter((tool) => tool.name !== "create_transactions");
    expect(readTools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    // The write tool must NOT be read-only, or clients auto-approve it without prompting.
    const write = tools.find((tool) => tool.name === "create_transactions");
    expect(write?.annotations?.readOnlyHint).toBeUndefined();
    expect(write?.annotations?.destructiveHint).toBe(false);
    expect(write?.annotations?.idempotentHint).toBe(true);
  });
});
