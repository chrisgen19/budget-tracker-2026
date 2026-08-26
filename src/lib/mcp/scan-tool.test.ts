import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBudgetMcpServer } from "./server";
import type { PrismaClient } from "../budget-query-types";

const prisma = {} as PrismaClient;

const listTools = async (scopes?: string[]) => {
  const server = createBudgetMcpServer({
    prisma,
    userId: "user_1",
    timezoneOffset: -480,
    scopes: scopes as never,
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
};

const callScan = async (scopes: string[], args: Record<string, unknown>) => {
  const server = createBudgetMcpServer({
    prisma,
    userId: "user_1",
    timezoneOffset: -480,
    scopes: scopes as never,
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const res = await client.callTool({ name: "scan_receipt", arguments: args });
  await client.close();
  return res;
};

describe("scan_receipt", () => {
  it("is absent from a token without receipts:scan", async () => {
    const names = (await listTools(["budget:read", "transactions:write"])).map((t) => t.name);
    expect(names).not.toContain("scan_receipt");
  });

  // The hazard this covers: receipts:scan does not end in ":write", so the original definition of
  // read-only would have filed it as harmless and granted it by default, including to the local
  // stdio server which passes no scopes at all.
  it("is absent when no scopes are given", async () => {
    const names = (await listTools()).map((t) => t.name);
    expect(names).not.toContain("scan_receipt");
  });

  it("is present with receipts:scan", async () => {
    const names = (await listTools(["receipts:scan"])).map((t) => t.name);
    expect(names).toEqual(["scan_receipt"]);
  });

  it("refuses malformed base64 before anything is reserved", async () => {
    // Buffer.from ignores invalid base64 rather than throwing, so an empty decode is the only
    // signal. Reaching Gemini with this would have cost the user a scan for nothing.
    const res = await callScan(["receipts:scan"], {
      imageBase64: "!!!!",
      mimeType: "image/jpeg",
    });
    expect(res.isError).toBe(true);
    expect((res.content as { text?: string }[])[0].text).toContain("not valid base64");
  });

  it("rejects a mime type the scan pipeline cannot accept", async () => {
    const res = await callScan(["receipts:scan"], {
      imageBase64: Buffer.from("x").toString("base64"),
      mimeType: "application/pdf",
    });
    // Refused by input validation, so no credit is reserved and Gemini is never called.
    expect(res.isError).toBe(true);
  });

  it("declares an image size limit in its description, since callers cannot discover it", async () => {
    const tool = (await listTools(["receipts:scan"]))[0];
    expect(tool.description).toContain("4 MB");
  });

  it("tells a caller that can see the image to read it itself", async () => {
    // The tool spends real money per call. A vision-capable client has no business using it.
    const tool = (await listTools(["receipts:scan"]))[0];
    expect(tool.description).toMatch(/if you can see the image/i);
  });
});
