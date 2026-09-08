import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createBudgetMcpServer } from "@/lib/mcp/server";
import { authenticateMcpRequest, type McpAuthFailure } from "@/lib/mcp/tokens";
import { MAX_BASE64_LENGTH } from "@/lib/receipt-limits";
import { overBodySizeLimit, readJsonWithinLimit } from "@/lib/request-size";

/** Every request reads the database and mints a fresh server, so nothing here is cacheable. */
export const dynamic = "force-dynamic";

/** JSON-RPC error codes: -32603 is the spec's Internal error; -32001 is the SDK's convention
 *  for auth failures. -32700 is Parse error, matching what the transport returns for a body it
 *  cannot read, and -32600 is Invalid Request. */
const JSONRPC_UNAUTHORIZED = -32001;
const JSONRPC_INTERNAL_ERROR = -32603;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;

/**
 * Ceiling on one MCP request body, in bytes.
 *
 * The transport reads the body with a bare `await req.json()` and applies no limit of its own
 * (`webStandardStreamableHttp.js`), so before this the only ingress bound was the network's
 * (#245). It is not the tool schemas that were unbounded — `create_transactions` caps rows at
 * `MAX_BATCH_TRANSACTIONS` and descriptions at 255, and does not accept a `receiptBreakdown` at
 * all — it is that the body is materialised *before* any schema is consulted, so a valid token
 * of any scope, read-only included, could post a body of any size.
 *
 * Derived rather than chosen, and deliberately **not** the batch route's `MAX_BATCH_BODY_BYTES`.
 * `scan_receipt` legitimately carries a base64 image bounded by `MAX_BASE64_LENGTH` (5.33 MB for
 * a 4 MB file), so the 5 MB ceiling that suits `POST /api/transactions/batch` would refuse every
 * receipt scan over MCP. Deriving it means a change to `MAX_FILE_SIZE` carries this with it
 * instead of silently breaking scanning. The 2 MB of headroom covers the JSON-RPC envelope, the
 * method name and the other params; base64 needs no escaping, so the encoded image costs its own
 * length and nothing more.
 */
const MAX_MCP_BODY_BYTES = MAX_BASE64_LENGTH + 2 * 1024 * 1024;

/** A JSON-RPC error envelope. An MCP client parses these, not a framework error page. */
const jsonRpcError = (status: number, code: number, message: string) =>
  NextResponse.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });

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
    createdVia: auth.source,
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  // DELETE terminates a session and carries no body, so there is nothing to meter and reading
  // one would throw. Only POST carries JSON-RPC.
  if (request.method !== "POST") return transport.handleRequest(request);

  const body = await readBodyWithinLimit(request);
  if ("refusal" in body) return body.refusal;

  // `parsedBody` is the transport's own documented hook for a caller that has already read the
  // body ("useful when using body-parser middleware"), so metering costs no reconstructed
  // Request and no second parse.
  return transport.handleRequest(request, { parsedBody: body.value });
};

/**
 * Read the JSON-RPC body under `MAX_MCP_BODY_BYTES`, in the envelopes this route already speaks.
 *
 * Note this moves the size check *ahead* of the transport's own `Accept` (406) and `Content-Type`
 * (415) validation, which it does before touching the body. That ordering is deliberate: a
 * ceiling is only a ceiling if nothing is buffered before it, and refusing an oversized body
 * without first judging its headers is the safer direction. The cost is that a request with a bad
 * `Accept` header now has its body read before the 406 — bounded by the ceiling, and it is a
 * malformed request either way.
 *
 * A body that is not JSON returns the transport's own parse error rather than this route's
 * generic 500, so metering does not change what a client sees for a malformed request.
 */
const readBodyWithinLimit = async (
  request: Request,
): Promise<{ value: unknown } | { refusal: NextResponse }> => {
  // The cheap half first: an honest oversized client is refused with nothing buffered at all.
  if (overBodySizeLimit(request, MAX_MCP_BODY_BYTES)) return { refusal: tooLarge() };

  try {
    const read = await readJsonWithinLimit(request, MAX_MCP_BODY_BYTES);
    if (!read.ok) return { refusal: tooLarge() };
    // `undefined` would make the transport fall back to re-reading a body already consumed.
    // JSON cannot encode it, so this is unreachable, but the fallback it would trigger is silent.
    if (read.value === undefined) {
      return { refusal: jsonRpcError(400, JSONRPC_INVALID_REQUEST, "Empty request body.") };
    }
    return { value: read.value };
  } catch {
    return { refusal: jsonRpcError(400, JSONRPC_PARSE_ERROR, "Parse error: Invalid JSON") };
  }
};

const tooLarge = () =>
  jsonRpcError(
    413,
    JSONRPC_INVALID_REQUEST,
    "Request body too large. Send fewer items, or a smaller image.",
  );

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
