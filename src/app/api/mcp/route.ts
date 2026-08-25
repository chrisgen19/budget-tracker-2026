import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createBudgetMcpServer } from "@/lib/mcp/server";
import { authenticateMcpRequest, type McpAuthFailure } from "@/lib/mcp/tokens";

/** Every request reads the database and mints a fresh server, so nothing here is cacheable. */
export const dynamic = "force-dynamic";

/** JSON-RPC error codes: -32603 is the spec's Internal error; -32001 is the SDK's convention
 *  for auth failures. */
const JSONRPC_UNAUTHORIZED = -32001;
const JSONRPC_INTERNAL_ERROR = -32603;
const JSONRPC_METHOD_NOT_FOUND = -32601;

/**
 * Render an auth failure.
 *
 * Every reason except rate limiting collapses to the same bare 401 body: distinguishing
 * "revoked" from "no such token" would confirm to an unauthenticated caller that the token it
 * presented is real. The distinction stays server-side, in the returned `reason`.
 */
const unauthorized = (failure: McpAuthFailure) => {
  if (failure.reason === "RATE_LIMITED") {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: JSONRPC_UNAUTHORIZED, message: "Rate limit exceeded for this token." },
        id: null,
      },
      { status: 429, headers: { "Retry-After": String(failure.retryAfterSeconds) } }
    );
  }

  return NextResponse.json(
    {
      jsonrpc: "2.0",
      error: { code: JSONRPC_UNAUTHORIZED, message: "Invalid or missing MCP token." },
      id: null,
    },
    {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="budgettracker"' },
    }
  );
};

/**
 * Remote MCP endpoint, authenticated by a static bearer token minted in Profile > Settings.
 *
 * Deliberately *not* an OAuth 2.1 authorization server (see #123 for why). It therefore needs a
 * client that can send a request header: Claude Desktop and Claude Code always, and claude.ai
 * web/mobile wherever request-header authentication is enabled for the account.
 *
 * Accepts the credential as `Authorization: Bearer <token>` or `X-Api-Key: <token>`. The latter
 * is not redundant: clients that own the `Authorization` header for OAuth either refuse to let
 * you set it or react to its 401 by starting an OAuth flow.
 *
 * The transport runs stateless (no `sessionIdGenerator`): a route handler has no process to
 * pin a session to, and a server instance kept across requests would hand one caller's
 * transport to the next. Each request therefore builds its own server, scoped to the token's
 * granted scopes, and lets it fall out of scope with the response.
 */
const handle = async (request: Request) => {
  try {
    return await serve(request);
  } catch (error) {
    // An MCP client parses JSON-RPC, not the framework's default 500 page, so an unexpected
    // failure has to come back in an envelope it can read and report.
    console.error("[mcp] request failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: JSONRPC_INTERNAL_ERROR, message: "Internal server error." },
        id: null,
      },
      { status: 500 }
    );
  }
};

const serve = async (request: Request) => {
  const auth = await authenticateMcpRequest(request.headers);
  if (!auth.ok) return unauthorized(auth.failure);

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { timezoneOffset: true, mcpWritesEnabledUntil: true },
  });

  // The token's owner was deleted between minting and now. Cascade delete should have taken the
  // token with them, so this is unreachable in practice, but serving month boundaries off a
  // default offset would silently answer with the wrong months rather than fail.
  if (!user) return unauthorized({ reason: "INVALID" });

  const server = createBudgetMcpServer({
    prisma,
    userId: auth.userId,
    timezoneOffset: user.timezoneOffset,
    scopes: auth.scopes,
    writesEnabledUntil: user.mcpWritesEnabledUntil,
    tokenId: auth.tokenId,
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(request);
};

/**
 * Refuse the standalone SSE stream.
 *
 * The SDK client opens `GET` with `Accept: text/event-stream` as soon as `initialized` is
 * acknowledged. Serving it here would build a `ReadableStream` and arm a keep-alive interval on
 * a *per-request* transport that nothing ever writes to (with `enableJsonResponse`, every real
 * response goes back on its own POST), and nothing closes either, so each client would pin an
 * open request and a live timer on the server for the length of its session.
 *
 * 405 is the spec's way of saying the server offers no stream at this endpoint; the SDK client
 * treats it as expected and carries on over POST alone.
 */
const rejectStream = async () =>
  NextResponse.json(
    {
      jsonrpc: "2.0",
      error: { code: JSONRPC_METHOD_NOT_FOUND, message: "This endpoint does not offer an SSE stream." },
      id: null,
    },
    { status: 405, headers: { Allow: "POST, DELETE" } }
  );

export { handle as POST, handle as DELETE, rejectStream as GET };
