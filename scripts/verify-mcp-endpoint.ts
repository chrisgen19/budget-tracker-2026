/**
 * End-to-end check of the remote MCP endpoint (src/app/api/mcp/route.ts).
 *
 * Drives the real HTTP route with the SDK's own Streamable HTTP client — the same path Claude
 * Desktop takes — so it covers the parts unit tests cannot: bearer auth on a real request, the
 * stateless transport actually completing a JSON-RPC exchange, and scope narrowing surviving
 * the round trip.
 *
 * Needs a dev server and a database. Creates and deletes its own throwaway user:
 *
 *   pnpm dev -p 3111
 *   BASE_URL=http://localhost:3111 pnpm exec tsx scripts/verify-mcp-endpoint.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PrismaClient } from "@prisma/client";
import { mintMcpToken } from "../src/lib/mcp/tokens";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ENDPOINT = new URL("/api/mcp", BASE_URL);
const prisma = new PrismaClient();
const EMAIL = "mcp-endpoint-probe@scratch.invalid";
let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

/** Connect as an MCP client carrying a bearer token, and list what it can see. */
const toolNamesFor = async (token: string) => {
  const client = new Client({ name: "endpoint-probe", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(ENDPOINT, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });

  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();

  return tools.map((tool) => tool.name).sort();
};

/** Raw POST, for the cases where the SDK client would just throw on a non-200. */
const rawStatus = (authorization: string | null) =>
  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "probe", version: "1.0.0" },
      },
    }),
  });

async function main() {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({
    data: { name: "MCP endpoint probe", email: EMAIL, password: "x", timezoneOffset: -480 },
    select: { id: true },
  });

  // --- Rejections ---
  const anonymous = await rawStatus(null);
  check("an unauthenticated request is 401", anonymous.status, 401);
  check(
    "the 401 advertises bearer auth, so a client knows what to send",
    anonymous.headers.get("www-authenticate"),
    'Bearer realm="budgettracker"'
  );
  check("an unknown token is 401", (await rawStatus("Bearer btmcp_nope")).status, 401);

  // --- Full access ---
  const full = await mintMcpToken({
    userId: user.id,
    name: "full",
    scopes: ["budget:read", "transactions:read", "labels:read", "bills:read", "receipts:read"],
    expiresInDays: 30,
  });
  check("a valid token sees all 12 tools", (await toolNamesFor(full.token)).length, 12);

  // --- Scope narrowing over the wire ---
  const scoped = await mintMcpToken({
    userId: user.id,
    name: "bills only",
    scopes: ["bills:read"],
    expiresInDays: 30,
  });
  check(
    "a scoped token sees only its own tools",
    await toolNamesFor(scoped.token),
    ["get_bill_history", "get_upcoming_bills"]
  );

  // --- A real tool call, end to end ---
  const client = new Client({ name: "endpoint-probe", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(ENDPOINT, {
    requestInit: { headers: { Authorization: `Bearer ${full.token}` } },
  });
  await client.connect(transport);
  const result = await client.callTool({ name: "get_budget_overview", arguments: {} });
  await client.close();

  check(
    "a tool call returns structured content for the token's own user",
    typeof (result.structuredContent as Record<string, unknown> | undefined)?.totalIncome,
    "number"
  );

  // --- GET must not open a stream ---
  // Serving the standalone SSE stream from a stateless route pins an open request and a
  // keep-alive timer per client for the life of its session, on a transport nothing writes to.
  // The SDK client treats 405 as "no stream offered" and carries on over POST.
  const stream = await fetch(ENDPOINT, {
    method: "GET",
    headers: { Authorization: `Bearer ${full.token}`, Accept: "text/event-stream" },
  });
  check("GET declines to open an SSE stream", stream.status, 405);
  check(
    "the refusal is not itself a stream",
    stream.headers.get("content-type")?.startsWith("text/event-stream") ?? false,
    false
  );
  await stream.body?.cancel();

  // --- Revocation takes effect immediately ---
  await prisma.mcpToken.update({ where: { id: scoped.record.id }, data: { revokedAt: new Date() } });
  check("a revoked token is 401 on the next request", (await rawStatus(`Bearer ${scoped.token}`)).status, 401);

  // --- The precondition behind idempotent revocation ---
  // A repeat revoke matches no rows, which is exactly why the DELETE route must not treat an
  // update count of 0 as "not found": two tabs listing the same live token is ordinary, and
  // reporting failure for a token that is in fact revoked tells the user the opposite of the
  // truth at the worst moment. The route itself needs a browser session, so it is covered by the
  // manual test plan rather than here.
  const revokeAgain = await prisma.mcpToken.updateMany({
    where: { id: scoped.record.id, userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  check("a repeat revoke matches no rows, preserving the first timestamp", revokeAgain.count, 0);
}

main()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  });
