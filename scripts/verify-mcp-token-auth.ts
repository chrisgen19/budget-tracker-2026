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

/**
 * Refuse to report a pass the run did not earn.
 *
 * The timestamp regression the rate-limit checks below exist to catch only appears when the
 * database session is *not* UTC: a `Date` bound into `$queryRaw` is sent as `timestamptz` and
 * compared through the session's zone. On a UTC server those checks pass identically with and
 * without the fix, so a green run there would prove nothing. Fail loudly instead.
 *
 * Checked rather than forced: Prisma pools connections, so a `SET TIME ZONE` would apply to
 * whichever connection happened to run it and not to the concurrent burst further down.
 */
const requireNonUtcSession = async () => {
  const [row] = await prisma.$queryRawUnsafe<{ TimeZone: string }[]>("SHOW TimeZone");
  const zone = row?.TimeZone ?? "unknown";

  if (/^(UTC|GMT|Etc\/UTC|Etc\/GMT[+-]?0?)$/i.test(zone)) {
    failures++;
    console.log(
      `FAIL  session timezone is ${zone}: the rate-limit checks cannot detect the timestamp ` +
        `regression on a UTC server. Re-run against a database configured otherwise, e.g. ` +
        `ALTER DATABASE "${process.env.PGDATABASE ?? "your_db"}" SET timezone = 'Asia/Manila'.`
    );
    return;
  }
  console.log(`INFO  session timezone is ${zone}; the timestamp checks below are meaningful`);
};

/** Build the request headers a client would send, so the checks exercise the real reader. */
const authHeaders = (value: string | null, name = "authorization") =>
  new Headers(value === null ? {} : { [name]: value });

const reasonOf = async (header: string | null, now?: Date) => {
  const result = await authenticateMcpRequest(authHeaders(header), now);
  return result.ok ? "OK" : result.failure.reason;
};

/** Same, for the `X-Api-Key` header. */
const apiKeyReasonOf = async (value: string | null) => {
  const result = await authenticateMcpRequest(authHeaders(value, "x-api-key"));
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

  // The window must be stored in UTC: `consumeRateLimit` compares it against
  // `now() AT TIME ZONE 'UTC'`. Prisma supplies it, but a raw INSERT that omitted the column
  // would take the SQL default, which resolves to the session zone and starts the window hours
  // ahead. Asserted on the path that actually runs.
  const [minted] = await prisma.$queryRawUnsafe<{ skew_seconds: number }[]>(
    `SELECT EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC') - rate_window_start))::float8 AS skew_seconds
       FROM mcp_tokens WHERE id = $1`,
    record.id
  );
  check(
    "a minted token's rate window starts in UTC, not the session zone",
    Math.abs(minted.skew_seconds) < 60,
    true
  );

  check("the plaintext is never persisted", await prisma.mcpToken.count({ where: { tokenHash: token } }), 0);
  check("a valid bearer authenticates", await reasonOf(`Bearer ${token}`), "OK");
  // Asserted on the authenticate result, not on what mint wrote: the narrowing happens in
  // `parseScopes` on the way out, so reading the row back would not exercise it.
  const accepted = await authenticateMcpRequest(authHeaders(`Bearer ${token}`));
  check(
    "scopes come back narrowed to what was granted",
    accepted.ok ? accepted.scopes : null,
    ["bills:read"]
  );

  check("a missing header is MISSING", await reasonOf(null), "MISSING");
  check("a non-bearer scheme is MISSING", await reasonOf(`Token ${token}`), "MISSING");
  check("bearer with no value is MISSING", await reasonOf("Bearer "), "MISSING");
  check("an unknown token is INVALID", await reasonOf("Bearer btmcp_nope"), "INVALID");
  check("the header is case-insensitive on the scheme", await reasonOf(`bearer ${token}`), "OK");

  // --- X-Api-Key, the header that exists because Authorization is unusable with the clients
  // that most want this endpoint (see the comment on readPresentedToken) ---
  check("an x-api-key header authenticates", await apiKeyReasonOf(token), "OK");
  check("x-api-key takes the raw token, with no scheme", await apiKeyReasonOf(`Bearer ${token}`), "INVALID");
  check("an empty x-api-key is MISSING", await apiKeyReasonOf(""), "MISSING");
  check("an unknown x-api-key is INVALID", await apiKeyReasonOf("btmcp_nope"), "INVALID");

  // Authorization wins, so a stale x-api-key further down a config cannot silently override a
  // deliberately set bearer token.
  const both = await authenticateMcpRequest(
    new Headers({ authorization: `Bearer ${token}`, "x-api-key": "btmcp_nope" })
  );
  check("Authorization takes precedence when both are sent", both.ok ? "OK" : both.failure.reason, "OK");

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
  // Revocation is the response to a leak, so a revoked token is exactly the one whose replay
  // needs a ceiling. Measured as a delta across one refused attempt: this token authenticated
  // successfully before it was revoked, so its absolute count is already non-zero and would
  // prove nothing. If the revoked branch short-circuits ahead of the limiter, the delta is 0.
  const countOf = async () =>
    (await prisma.mcpToken.findUnique({
      where: { id: revocable.record.id },
      select: { rateCount: true },
    }))?.rateCount ?? -1;

  const before = await countOf();
  check("a revoked token is REVOKED", await reasonOf(`Bearer ${revocable.token}`), "REVOKED");
  check("a revoked token still consumes its rate window", (await countOf()) - before, 1);

  // --- Rate limit, the reason this script needs a real database ---
  await requireNonUtcSession();

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

  const refusal = await authenticateMcpRequest(authHeaders(`Bearer ${limited.token}`));
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
