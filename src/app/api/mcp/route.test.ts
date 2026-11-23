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

/**
 * The 401 challenge must not advertise OAuth.
 *
 * `WWW-Authenticate: Bearer` is RFC 6750's OAuth challenge, which this app is not an
 * authorization server for. These tests pin the **header value** and nothing about how a client
 * reacts to it: the MCP SDK's client enters its OAuth flow on any 401 when it has an
 * `authProvider`, so a bridge such as `mcp-remote` can still reach `/register` whatever this says.
 * See `WWW_AUTHENTICATE` in `route.ts`. The original connector error ("Couldn't register with
 * this connector's sign-in service", for a credential that had merely expired) is remedied by
 * re-minting the token, not by this header.
 */
describe("POST /api/mcp 401 challenge", () => {
  const EXPECTED = 'ApiKey realm="budgettracker", header="x-api-key"';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ timezoneOffset: -480, mcpWritesEnabledUntil: null });
    mocks.createBudgetMcpServer.mockReturnValue({ connect: mocks.connect });
    mocks.handleRequest.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  it("does not advertise bearer auth", async () => {
    mocks.authenticateMcpRequest.mockResolvedValue({ ok: false, failure: { reason: "MISSING" } });

    const response = await POST(postRequest(call("get_budget_overview", {})));
    const challenge = response.headers.get("www-authenticate");

    expect(response.status).toBe(401);
    // The assertion that fails if the scheme is put back, however the rest is spelled.
    expect(challenge).not.toMatch(/bearer/i);
    expect(challenge).toBe(EXPECTED);
  });

  it("still carries a challenge, which RFC 9110 requires on a 401", async () => {
    // Dropping the header was the other candidate fix. A 401 must say how to authenticate, so
    // the scheme changed instead of disappearing.
    mocks.authenticateMcpRequest.mockResolvedValue({ ok: false, failure: { reason: "MISSING" } });

    const response = await POST(postRequest(call("get_budget_overview", {})));

    expect(response.headers.has("www-authenticate")).toBe(true);
  });

  it("names the header a client should send, so the challenge is actionable", async () => {
    mocks.authenticateMcpRequest.mockResolvedValue({ ok: false, failure: { reason: "MISSING" } });

    const response = await POST(postRequest(call("get_budget_overview", {})));

    expect(response.headers.get("www-authenticate")).toContain('header="x-api-key"');
  });

  // Expiry and revocation are how a *working* connector breaks -- write tokens are capped at 90
  // days -- so a fix that only covered a missing credential would miss the real case.
  it.each(["MISSING", "INVALID", "REVOKED", "EXPIRED"] as const)(
    "sends the same non-OAuth challenge for a %s credential",
    async (reason) => {
      mocks.authenticateMcpRequest.mockResolvedValue({ ok: false, failure: { reason } });

      const response = await POST(postRequest(call("get_budget_overview", {})));

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(EXPECTED);
    },
  );

  it("reports a bad credential in the body", async () => {
    mocks.authenticateMcpRequest.mockResolvedValue({ ok: false, failure: { reason: "EXPIRED" } });

    const response = await POST(postRequest(call("get_budget_overview", {})));

    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Invalid or missing MCP token." },
    });
  });

  it("challenges on a 401 for a deleted owner too, since that path shares the response", async () => {
    mocks.authenticateMcpRequest.mockResolvedValue({
      ok: true,
      userId: "user-1",
      scopes: ["budget:read"],
      tokenId: "tok-1",
      source: "AI",
    });
    mocks.findUnique.mockResolvedValue(null);

    const response = await POST(postRequest(call("get_budget_overview", {})));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(EXPECTED);
  });

  it("leaves the rate limit a 429 with no challenge, since the credential may be fine", async () => {
    mocks.authenticateMcpRequest.mockResolvedValue({
      ok: false,
      failure: { reason: "RATE_LIMITED", retryAfterSeconds: 42 },
    });

    const response = await POST(postRequest(call("get_budget_overview", {})));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.has("www-authenticate")).toBe(false);
  });
});
