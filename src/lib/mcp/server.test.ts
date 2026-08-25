import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBudgetMcpServer } from "./server";
import { MCP_TOOL_SCOPES, type McpScope } from "./scopes";
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

describe("createBudgetMcpServer", () => {
  it("serves every tool when no scopes are given, as the stdio entry point expects", async () => {
    expect(await listToolNames()).toEqual(Object.keys(MCP_TOOL_SCOPES).sort());
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
    const registered = await listToolNames();
    const mapped = Object.keys(MCP_TOOL_SCOPES).sort();

    expect(registered).toEqual(mapped);
  });

  it("keeps every read tool read-only and marks the write tool as not", async () => {
    const server = createBudgetMcpServer({ prisma, userId: "user_1", timezoneOffset: -480 });
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
