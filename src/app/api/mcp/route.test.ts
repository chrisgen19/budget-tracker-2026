import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BASE64_LENGTH } from "@/lib/receipt-limits";

const mocks = vi.hoisted(() => ({
  authenticateMcpRequest: vi.fn(),
  findUnique: vi.fn(),
  createBudgetMcpServer: vi.fn(),
  connect: vi.fn(),
  handleRequest: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/mcp/tokens", () => ({ authenticateMcpRequest: mocks.authenticateMcpRequest }));
vi.mock("@/lib/mcp/server", () => ({ createBudgetMcpServer: mocks.createBudgetMcpServer }));
vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({
  WebStandardStreamableHTTPServerTransport: class {
    handleRequest = mocks.handleRequest;
  },
}));

import { DELETE, POST } from "@/app/api/mcp/route";

/** The ceiling the route derives: a full-size base64 image plus envelope headroom. */
const LIMIT = MAX_BASE64_LENGTH + 2 * 1024 * 1024;

const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: "Bearer token",
};

const call = (method: string, params: unknown) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: method, arguments: params },
});

const postRequest = (body: unknown) =>
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
  });

/** No `content-length`, so only a metered read can bound it. */
const chunkedRequest = (body: unknown, method = "POST") =>
  new Request("http://localhost/api/mcp", {
    method,
    headers: MCP_HEADERS,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(JSON.stringify(body));
        for (let at = 0; at < bytes.byteLength; at += 256 * 1024) {
          controller.enqueue(bytes.slice(at, at + 256 * 1024));
        }
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });

const declaredRequest = (body: unknown) => {
  const payload = JSON.stringify(body);
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, "content-length": String(payload.length) },
    body: payload,
  });
};

describe("POST /api/mcp body ceiling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateMcpRequest.mockResolvedValue({
      ok: true,
      userId: "user-1",
      scopes: ["budget:read"],
      tokenId: "tok-1",
      source: "AI",
    });
    mocks.findUnique.mockResolvedValue({ timezoneOffset: -480, mcpWritesEnabledUntil: null });
    mocks.createBudgetMcpServer.mockReturnValue({ connect: mocks.connect });
    mocks.handleRequest.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  it("passes an ordinary call through to the transport as a pre-parsed body", async () => {
    const body = call("get_budget_overview", {});
    const response = await POST(postRequest(body));

    expect(response.status).toBe(200);
    // The transport must be handed the parsed body, not left to re-read a consumed stream.
    expect(mocks.handleRequest).toHaveBeenCalledWith(expect.anything(), { parsedBody: body });
  });

  it("admits a full-size base64 image, which the batch route's 5 MB ceiling would refuse", async () => {
    // The trap this constant exists to avoid: scan_receipt legitimately carries MAX_BASE64_LENGTH
    // (5.33 MB) of base64, so copying MAX_BATCH_BODY_BYTES would break every scan over MCP.
    const body = call("scan_receipt", {
      imageBase64: "A".repeat(MAX_BASE64_LENGTH),
      mimeType: "image/jpeg",
    });

    const response = await POST(chunkedRequest(body));

    expect(response.status).toBe(200);
    expect(mocks.handleRequest).toHaveBeenCalledOnce();
  });

  it("refuses a declared oversize without reading the body or building a server", async () => {
    const request = declaredRequest(call("scan_receipt", { pad: "A".repeat(LIMIT) }));

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32600 },
    });
    expect(request.bodyUsed).toBe(false);
    expect(mocks.handleRequest).not.toHaveBeenCalled();
  });

  it("refuses an oversized body that declares no content-length", async () => {
    // The half a header check cannot do: the transport's own read is a bare req.json().
    const response = await POST(chunkedRequest(call("scan_receipt", { pad: "A".repeat(LIMIT) })));

    expect(response.status).toBe(413);
    expect(mocks.handleRequest).not.toHaveBeenCalled();
  });

  it("refuses before the body is read even for a read-only token", async () => {
    // Scope does not narrow this: the body is parsed before any tool is dispatched, so every
    // valid token reaches the same read.
    mocks.authenticateMcpRequest.mockResolvedValue({
      ok: true,
      userId: "user-1",
      scopes: ["budget:read"],
      tokenId: "tok-1",
      source: "AI",
    });

    const response = await POST(chunkedRequest(call("get_budget_overview", { pad: "A".repeat(LIMIT) })));

    expect(response.status).toBe(413);
  });

  it("returns the transport's own parse error for a malformed body, not a 500", async () => {
    const response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: MCP_HEADERS,
        body: "{not json",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32700 } });
    expect(mocks.handleRequest).not.toHaveBeenCalled();
  });

  it("leaves DELETE alone, since a session termination carries no body", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/mcp", { method: "DELETE", headers: MCP_HEADERS }),
    );

    expect(response.status).toBe(200);
    // No parsedBody: metering a bodyless request would throw where the transport reads nothing.
    expect(mocks.handleRequest).toHaveBeenCalledWith(expect.anything());
  });

  it("refuses an unauthenticated request before reading anything", async () => {
    mocks.authenticateMcpRequest.mockResolvedValue({ ok: false, failure: { reason: "INVALID" } });

    const request = declaredRequest(call("get_budget_overview", {}));
    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(mocks.handleRequest).not.toHaveBeenCalled();
  });
});
