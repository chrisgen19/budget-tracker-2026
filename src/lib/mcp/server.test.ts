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

describe("search_transactions provenance filter", () => {
  /**
   * The filter has to know about every value `created_via` can hold.
   *
   * It listed APP and MCP only, so once a Telegram token started stamping TELEGRAM, asking for
   * those rows failed input validation instead of returning them: the bot could write rows that
   * nothing could then audit.
   */
  it("accepts every source a row can carry", async () => {
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

    const search = tools.find((tool) => tool.name === "search_transactions");
    const properties = search?.inputSchema.properties as
      | Record<string, { enum?: string[] }>
      | undefined;

    expect(properties?.createdVia.enum).toEqual(["APP", "MCP", "TELEGRAM"]);
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

    // Anything that changes data or spends a metered resource must not be marked read-only, or
    // clients auto-approve it without prompting.
    const PROMPTS_BEFORE_RUNNING = [
      "create_transactions",
      "update_transactions",
      "scan_receipt",
    ];

    const readTools = tools.filter((tool) => !PROMPTS_BEFORE_RUNNING.includes(tool.name));
    expect(readTools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    expect(readTools).toHaveLength(tools.length - PROMPTS_BEFORE_RUNNING.length);

    for (const name of PROMPTS_BEFORE_RUNNING) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool?.annotations?.readOnlyHint, name).toBeUndefined();
    }

    // Only one tool here overwrites data that already exists, and it is the only one that may
    // say so. Marking creating or scanning destructive would cry wolf on the two calls that
    // cannot lose anything; marking editing non-destructive would let a client treat rewriting a
    // recorded amount as no more consequential than adding a row.
    expect(
      tools.find((t) => t.name === "update_transactions")?.annotations?.destructiveHint
    ).toBe(true);
    expect(
      tools.find((t) => t.name === "create_transactions")?.annotations?.destructiveHint
    ).toBe(false);
    expect(tools.find((t) => t.name === "scan_receipt")?.annotations?.destructiveHint).toBe(false);

    // Replaying a clientBatchId returns the original rows, so the write is idempotent, and a
    // patch describes a destination rather than a delta, so re-applying one lands on the same
    // row. A second scan is neither: it costs another credit and Gemini may read it differently.
    expect(tools.find((t) => t.name === "create_transactions")?.annotations?.idempotentHint).toBe(true);
    expect(tools.find((t) => t.name === "update_transactions")?.annotations?.idempotentHint).toBe(true);
    expect(tools.find((t) => t.name === "scan_receipt")?.annotations?.idempotentHint).toBe(false);
  });

  // --- The edit tool is a separate grant from the create tool ---

  it("exposes the edit tool only with transactions:edit", async () => {
    expect(await listToolNames(["transactions:edit"])).toEqual(["update_transactions"]);
  });

  it("gives a create-only token no way to edit", async () => {
    // The property that lets the Telegram bot keep its existing token unchanged: it holds
    // transactions:write, so `update_transactions` must not merely refuse it on call -- it must
    // not be listed at all. Pointing both tools at one scope would silently arm every write
    // token already in the wild.
    expect(await listToolNames(["transactions:write"])).toEqual(["create_transactions"]);
  });

  it("never exposes the edit tool to a read-only token", async () => {
    const names = await listToolNames(["budget:read", "transactions:read", "receipts:read"]);
    expect(names).not.toContain("update_transactions");
  });

  it("does not offer the edit tool when no scopes are given", async () => {
    // The local stdio server's case: it passes no scopes and supplies no write lease.
    expect(await listToolNames()).not.toContain("update_transactions");
  });
});

describe("update_transactions permission", () => {
  /** Calls `update_transactions` and returns the tool's own response. */
  const callUpdate = async (options: Parameters<typeof createBudgetMcpServer>[0]) => {
    const server = createBudgetMcpServer(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "update_transactions",
      arguments: { transactions: [{ id: "tx_1", amount: 320 }] },
    });
    await client.close();
    return result;
  };

  it("refuses to edit when the write lease is off, before touching the database", async () => {
    // The scope is granted and the tool is listed; the kill switch is what stops it. `prisma` is
    // the bare stub, so reaching a query at all would throw rather than return this message.
    const result = await callUpdate({
      prisma,
      userId: "user_1",
      timezoneOffset: -480,
      scopes: ["transactions:edit"],
      writesEnabledUntil: null,
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Writes are currently switched off");
  });

  it("refuses to edit when the lease has lapsed", async () => {
    const result = await callUpdate({
      prisma,
      userId: "user_1",
      timezoneOffset: -480,
      scopes: ["transactions:edit"],
      writesEnabledUntil: new Date(Date.now() - 1_000),
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Writes are currently switched off");
  });
});
