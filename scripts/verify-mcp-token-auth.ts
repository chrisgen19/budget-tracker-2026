/**
 * Verification harness for remote MCP token auth (src/lib/mcp/tokens.ts).
 *
 * The rate limiter is the part that cannot be tested in jsdom: it relies on a single Postgres
 * `UPDATE` taking a row lock so concurrent requests serialise. A read-then-write version passes
 * every single-threaded test and enforces nothing in production, which is exactly the failure
 * these checks exist to catch.
 *
 * Creates and deletes its own throwaway user, so it is safe to run against a dev database:
 *
 *   pnpm exec tsx scripts/verify-mcp-token-auth.ts
 */
import { PrismaClient } from "@prisma/client";
import { authenticateMcpRequest, mintMcpToken, MCP_RATE_LIMIT } from "../src/lib/mcp/tokens";

const prisma = new PrismaClient();
const EMAIL = "mcp-token-probe@scratch.invalid";
let failures = 0;

const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

const reasonOf = async (header: string | null, now?: Date) => {
  const result = await authenticateMcpRequest(header, now);
  return result.ok ? "OK" : result.failure.reason;
};

async function main() {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({
    data: { name: "MCP probe", email: EMAIL, password: "x", timezoneOffset: -480 },
    select: { id: true },
  });

  const { token, record } = await mintMcpToken({
    userId: user.id,
    name: "probe",
    scopes: ["bills:read"],
    expiresInDays: 30,
  });

  check("the plaintext is never persisted", await prisma.mcpToken.count({ where: { tokenHash: token } }), 0);
  check("a valid bearer authenticates", await reasonOf(`Bearer ${token}`), "OK");
  check("scopes come back narrowed to what was granted", record.scopes, ["bills:read"]);

  check("a missing header is MISSING", await reasonOf(null), "MISSING");
  check("a non-bearer scheme is MISSING", await reasonOf(`Token ${token}`), "MISSING");
  check("bearer with no value is MISSING", await reasonOf("Bearer "), "MISSING");
  check("an unknown token is INVALID", await reasonOf("Bearer btmcp_nope"), "INVALID");
  check("the header is case-insensitive on the scheme", await reasonOf(`bearer ${token}`), "OK");

  // --- Expiry ---
  const future = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
  check("an expired token is EXPIRED", await reasonOf(`Bearer ${token}`, future), "EXPIRED");

  // --- Revocation ---
  const revocable = await mintMcpToken({
    userId: user.id,
    name: "revocable",
    scopes: ["budget:read"],
    expiresInDays: null,
  });
  check("a never-expiring token authenticates", await reasonOf(`Bearer ${revocable.token}`), "OK");
  await prisma.mcpToken.update({ where: { id: revocable.record.id }, data: { revokedAt: new Date() } });
  check("a revoked token is REVOKED", await reasonOf(`Bearer ${revocable.token}`), "REVOKED");

  // --- Rate limit, the reason this script needs a real database ---
  const limited = await mintMcpToken({
    userId: user.id,
    name: "rate limited",
    scopes: ["budget:read"],
    expiresInDays: 30,
  });

  // Park the counter one request below the ceiling rather than issuing hundreds of round trips.
  await prisma.mcpToken.update({
    where: { id: limited.record.id },
    data: { rateCount: MCP_RATE_LIMIT.maxRequests - 1, rateWindowStart: new Date() },
  });
  check("the last request in the window is allowed", await reasonOf(`Bearer ${limited.token}`), "OK");
  check("the next one is refused", await reasonOf(`Bearer ${limited.token}`), "RATE_LIMITED");

  const refusal = await authenticateMcpRequest(`Bearer ${limited.token}`);
  const retryAfter = !refusal.ok && refusal.failure.reason === "RATE_LIMITED" ? refusal.failure.retryAfterSeconds : 0;
  check(
    "Retry-After is positive and within the window",
    retryAfter > 0 && retryAfter <= MCP_RATE_LIMIT.windowMs / 1000,
    true
  );

  // A lapsed window resets on the next request, with no sweeper involved.
  await prisma.mcpToken.update({
    where: { id: limited.record.id },
    data: { rateWindowStart: new Date(Date.now() - MCP_RATE_LIMIT.windowMs - 1000) },
  });
  check("a lapsed window resets lazily", await reasonOf(`Bearer ${limited.token}`), "OK");
  check(
    "the reset starts the count at one, not zero",
    (await prisma.mcpToken.findUnique({ where: { id: limited.record.id }, select: { rateCount: true } }))?.rateCount,
    1
  );

  // --- Concurrency: the check a read-then-write limiter fails ---
  const racer = await mintMcpToken({
    userId: user.id,
    name: "racer",
    scopes: ["budget:read"],
    expiresInDays: 30,
  });
  const burst = 40;
  await prisma.mcpToken.update({
    where: { id: racer.record.id },
    data: { rateCount: MCP_RATE_LIMIT.maxRequests - burst / 2, rateWindowStart: new Date() },
  });

  const outcomes = await Promise.all(
    Array.from({ length: burst }, () => reasonOf(`Bearer ${racer.token}`))
  );
  check(
    "a concurrent burst admits exactly the remaining allowance",
    outcomes.filter((reason) => reason === "OK").length,
    burst / 2
  );

  // --- Ownership ---
  check(
    "last_used_at is stamped on every accepted request",
    (await prisma.mcpToken.findUnique({ where: { id: record.id }, select: { lastUsedAt: true } }))?.lastUsedAt !== null,
    true
  );
}

main()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    // Cleanup lives here so a throwing check cannot leave the probe user and its tokens behind,
    // and so $disconnect always runs: process.exit would preempt it otherwise.
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  });
