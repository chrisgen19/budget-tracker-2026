/**
 * End-to-end check of the remote MCP endpoint (src/app/api/mcp/route.ts).
 *
 * Drives the real HTTP route with the SDK's own Streamable HTTP client, the same path Claude
 * Desktop takes, so it covers the parts unit tests cannot: bearer auth on a real request, the
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
import { randomUUID } from "node:crypto";
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

/** Open a client on the endpoint with a given token. Caller closes it. */
const connect = async (token: string) => {
  const client = new Client({ name: "endpoint-probe", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(ENDPOINT, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
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

/** Raw POST with an arbitrary auth header, so both accepted header names can be exercised. */
const rawStatusWith = (headers: Record<string, string>) =>
  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
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

  // --- Write tool: scope, lease, idempotency, provenance ---
  const writer = await mintMcpToken({
    userId: user.id,
    name: "writer",
    scopes: ["budget:read", "transactions:write"],
    expiresInDays: 30,
  });

  const category = await prisma.category.findFirst({
    where: { OR: [{ userId: user.id }, { userId: null }], type: "EXPENSE" },
    select: { id: true },
  });
  if (!category) throw new Error("no expense category available to write against");

  const callCreate = async (token: string, clientBatchId: string, categoryId = category.id) => {
    const client = await connect(token);
    const result = await client.callTool({
      name: "create_transactions",
      arguments: {
        transactions: [
          { amount: 12.5, description: "probe", type: "EXPENSE", date: "2026-08-25", categoryId },
        ],
        clientBatchId,
      },
    });
    await client.close();
    return result;
  };

  // Writes are off for a fresh user, so the tool must refuse even though the scope is granted.
  const refused = await callCreate(writer.token, randomUUID());
  check("the write tool refuses while the lease is off", refused.isError, true);
  check(
    "the refusal names the switch to flip",
    JSON.stringify(refused.content).includes("Profile > MCP Access"),
    true
  );
  check("nothing was written while refused", await prisma.transaction.count({ where: { userId: user.id } }), 0);

  await prisma.user.update({
    where: { id: user.id },
    data: { mcpWritesEnabledUntil: new Date(Date.now() + 60 * 60 * 1000) },
  });

  const key = randomUUID();
  const first = await callCreate(writer.token, key);
  const firstOut = first.structuredContent as { created: number; replayed: boolean } | undefined;
  check("the write tool creates once the lease is live", firstOut?.created, 1);
  check("the first call is not a replay", firstOut?.replayed, false);

  // The whole point of requiring a key: an agent retry must not duplicate the rows.
  const replay = await callCreate(writer.token, key);
  const replayOut = replay.structuredContent as { created: number; replayed: boolean } | undefined;
  check("replaying the same clientBatchId creates nothing", replayOut?.created, 0);
  check("the replay is reported as one", replayOut?.replayed, true);
  check("exactly one row exists after the replay", await prisma.transaction.count({ where: { userId: user.id } }), 1);

  const written = await prisma.transaction.findFirstOrThrow({
    where: { userId: user.id },
    select: { createdVia: true, mcpTokenId: true },
  });
  check("the row records that MCP wrote it", written.createdVia, "MCP");
  check("the row records which token wrote it", written.mcpTokenId, writer.record.id);

  // A category that is not this user's must be refused, since the id comes from a model.
  const foreign = await prisma.user.create({
    data: { name: "other", email: "mcp-endpoint-other@scratch.invalid", password: "x" },
    select: { id: true },
  });
  const foreignCategory = await prisma.category.create({
    data: { name: "theirs", type: "EXPENSE", icon: "x", color: "#000", userId: foreign.id },
    select: { id: true },
  });
  const crossUser = await callCreate(writer.token, randomUUID(), foreignCategory.id);
  check("a category belonging to another user is refused", crossUser.isError, true);
  check("still exactly one row after the refusal", await prisma.transaction.count({ where: { userId: user.id } }), 1);
  await prisma.user.delete({ where: { id: foreign.id } });

  // The tool must not auto-apply scheduled labels: schedules match on time of day and weekday,
  // which describe when the user spent, not when a model typed the row in.
  const scheduledLabel = await prisma.label.create({
    data: {
      name: `probe-schedule-${Date.now()}`,
      color: "#000000",
      userId: user.id,
      applicableTo: "BOTH",
      schedules: { create: { days: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:59" } },
    },
    select: { id: true },
  });

  const unlabelled = await callCreate(writer.token, randomUUID());
  const unlabelledOut = unlabelled.structuredContent as
    | { transactions: { labels: string[] }[] }
    | undefined;
  check(
    "omitting labelIds does not auto-apply a scheduled label",
    unlabelledOut?.transactions[0]?.labels ?? ["<missing>"],
    []
  );
  await prisma.label.delete({ where: { id: scheduledLabel.id } });

  // An unparseable date must be named, not retried: it can never succeed.
  const badDateClient = await connect(writer.token);
  const badDate = await badDateClient.callTool({
    name: "create_transactions",
    arguments: {
      transactions: [
        { amount: 5, description: "bad", type: "EXPENSE", date: "not-a-date", categoryId: category.id },
      ],
      clientBatchId: randomUUID(),
    },
  });
  await badDateClient.close();
  check("an unparseable date is rejected before the write", badDate.isError, true);
  check(
    "the rejection names the date rather than telling the model to retry",
    JSON.stringify(badDate.content).includes("date"),
    true
  );

  // A bare date must land on the right local day. Stored as an instant, so a UTC-midnight
  // interpretation would put a 1st-of-month row inside the previous month for western users.
  const dateClient = await connect(writer.token);
  await dateClient.callTool({
    name: "create_transactions",
    arguments: {
      transactions: [
        { amount: 7, description: "tz probe", type: "EXPENSE", date: "2026-03-01", categoryId: category.id },
      ],
      clientBatchId: randomUUID(),
    },
  });
  await dateClient.close();

  const tzRow = await prisma.transaction.findFirstOrThrow({
    where: { userId: user.id, description: "tz probe" },
    select: { date: true },
  });
  const localMidnight = new Date(Date.UTC(2026, 2, 1) + -480 * 60_000).toISOString();
  check("a bare date is anchored to the user's local midnight", tzRow.date.toISOString(), localMidnight);

  // The confirmation the model reads back must name the same day the app shows, not the UTC one.
  const echoed = await callCreate(writer.token, randomUUID());
  const echoedOut = echoed.structuredContent as { transactions: { date: string }[] } | undefined;
  check("the echoed date is the user's local day", echoedOut?.transactions[0]?.date, "2026-08-25");

  // An impossible day must be refused even when it carries a time: appending one used to bypass
  // the calendar check entirely.
  const rolledClient = await connect(writer.token);
  const rolled = await rolledClient.callTool({
    name: "create_transactions",
    arguments: {
      transactions: [
        { amount: 3, description: "rolled", type: "EXPENSE", date: "2026-02-31T00:00:00Z", categoryId: category.id },
      ],
      clientBatchId: randomUUID(),
    },
  });
  await rolledClient.close();
  check("an impossible day carrying a time is refused", rolled.isError, true);
  check(
    "nothing was written for it",
    await prisma.transaction.count({ where: { userId: user.id, description: "rolled" } }),
    0
  );

  // An income category on an expense is internally inconsistent and would distort category
  // breakdowns. The app's picker filters by type; a model has no such constraint.
  const incomeCategory = await prisma.category.findFirstOrThrow({
    where: { OR: [{ userId: user.id }, { userId: null }], type: "INCOME" },
    select: { id: true },
  });
  const mismatched = await callCreate(writer.token, randomUUID(), incomeCategory.id);
  check("an income category on an expense is refused", mismatched.isError, true);

  // The provenance filter must be reachable from the read side too. Uses the read token, since
  // search_transactions belongs to transactions:read and the writer deliberately lacks it.
  const searchClient = await connect(full.token);
  const mine = await searchClient.callTool({
    name: "search_transactions",
    arguments: { createdVia: "MCP" },
  });
  await searchClient.close();
  const mineOut = mine.structuredContent as { transactions: unknown[] } | undefined;
  check(
    "search_transactions can filter to MCP-written rows",
    (mineOut?.transactions?.length ?? 0) > 0,
    true
  );

  // A read-only token must not even see the tool.
  const readOnlyClient = await connect(full.token);
  const readOnlyTools = (await readOnlyClient.listTools()).tools.map((t) => t.name);
  await readOnlyClient.close();
  check("a read-only token cannot see the write tool", readOnlyTools.includes("create_transactions"), false);

  // --- X-Api-Key over the wire ---
  // The header exists so that clients which own `Authorization` for OAuth can still present a
  // static credential. It has to authenticate on the first request: emitting a 401 is what
  // makes those clients abandon the credential and start an OAuth flow.
  check(
    "an x-api-key header authenticates over HTTP",
    (await rawStatusWith({ "x-api-key": full.token })).status,
    200
  );
  check(
    "an unknown x-api-key is still 401",
    (await rawStatusWith({ "x-api-key": "btmcp_nope" })).status,
    401
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
