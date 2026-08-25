import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseScopes, type McpScope } from "./scopes";

/** Distinctive prefix so a leaked token is greppable and recognisable in a config file. */
const TOKEN_PREFIX = "btmcp_";

/** 32 bytes of CSPRNG output. Well past guessing, which is what lets the digest be a plain
 *  SHA-256 rather than a password KDF (see the `McpToken` model comment). */
const TOKEN_BYTES = 32;

/** How much of the plaintext is kept in the clear so the UI can identify a token later. */
const PREFIX_KEEP = TOKEN_PREFIX.length + 6;

/** Fixed-window rate limit, per token.
 *
 *  This is the only ceiling on how hard a token can be pulled, valid or not: every tool is a
 *  database read, and nothing else here bounds request volume. It is charged before the
 *  revoked/expired checks so that a revoked credential cannot be replayed without limit. Sized well above real use — a Claude
 *  Desktop conversation issues a handful of tool calls per turn, not hundreds. */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 300;

export type McpAuthFailure =
  | { reason: "MISSING" }
  | { reason: "INVALID" }
  | { reason: "REVOKED" }
  | { reason: "EXPIRED" }
  | { reason: "RATE_LIMITED"; retryAfterSeconds: number };

export type McpAuthResult =
  | { ok: true; tokenId: string; userId: string; scopes: McpScope[] }
  | { ok: false; failure: McpAuthFailure };

export const hashMcpToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/**
 * Generate a new token and persist only its digest.
 *
 * The plaintext is returned once and never stored, so a lost token is re-minted, not recovered.
 *
 * @param expiresInDays Days until the token stops working. `null` means it never expires, which
 *   the caller has to choose deliberately — the UI defaults to a bounded lifetime.
 */
export const mintMcpToken = async (params: {
  userId: string;
  name: string;
  scopes: McpScope[];
  expiresInDays: number | null;
}) => {
  const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt =
    params.expiresInDays === null
      ? null
      : new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000);

  const record = await prisma.mcpToken.create({
    data: {
      userId: params.userId,
      name: params.name,
      prefix: token.slice(0, PREFIX_KEEP),
      tokenHash: hashMcpToken(token),
      scopes: params.scopes,
      expiresAt,
    },
    select: mcpTokenSelect,
  });

  return { token, record };
};

/** Fields safe to return to the browser. Deliberately excludes `tokenHash`. */
export const mcpTokenSelect = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

/** Extract the credential from an `Authorization: Bearer <token>` header. */
const readBearer = (header: string | null): string | null => {
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme.toLowerCase() !== "bearer" || rest.length === 0) return null;
  const value = rest.join(" ").trim();
  return value.length > 0 ? value : null;
};

/**
 * Consume one request against the token's fixed window.
 *
 * A single `UPDATE` rather than read-then-write: concurrent requests would otherwise both read
 * the same count and both pass, and the row lock Postgres takes for the update serialises them
 * for free. The window resets lazily on the first request after it lapses, so an idle token
 * needs no sweeper.
 *
 * Every instant is computed and returned *inside* SQL, never bound as a `Date`. Prisma maps
 * `DateTime` to `timestamp without time zone` holding UTC, but a `Date` bound into `$queryRaw`
 * is sent as `timestamptz` and compared through the session's timezone — under Asia/Manila that
 * made every window look 8 hours stale, so the limiter reset on each request and enforced
 * nothing. Reads have the mirror-image problem, so the window start comes back as an epoch
 * rather than a timestamp. `verify-mcp-token-auth.ts` covers both directions.
 *
 * @returns the request's position in the window, and when that window started (epoch seconds).
 */
const consumeRateLimit = async (tokenId: string) => {
  const lapsed = Prisma.sql`
    rate_window_start < (now() AT TIME ZONE 'UTC') - ${RATE_LIMIT_WINDOW_MS / 1000}::int * interval '1 second'
  `;

  const rows = await prisma.$queryRaw<{ rate_count: number; window_start_epoch: number }[]>(
    Prisma.sql`
      UPDATE mcp_tokens
      SET
        rate_window_start = CASE WHEN ${lapsed} THEN (now() AT TIME ZONE 'UTC') ELSE rate_window_start END,
        rate_count        = CASE WHEN ${lapsed} THEN 1 ELSE rate_count + 1 END,
        last_used_at      = (now() AT TIME ZONE 'UTC')
      WHERE id = ${tokenId}
      RETURNING
        rate_count,
        EXTRACT(EPOCH FROM (rate_window_start AT TIME ZONE 'UTC'))::float8 AS window_start_epoch
    `
  );

  return rows[0] ?? null;
};

/**
 * Authenticate a remote MCP request.
 *
 * Failure reasons are distinguished for logging and for the `WWW-Authenticate` description, but
 * callers must render every non-rate-limit failure as a bare 401: telling an unauthenticated
 * caller that its token exists but is revoked confirms the token is real.
 */
export const authenticateMcpRequest = async (
  authorization: string | null,
  now = new Date()
): Promise<McpAuthResult> => {
  const presented = readBearer(authorization);
  if (!presented) return { ok: false, failure: { reason: "MISSING" } };

  const record = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashMcpToken(presented) },
    select: { id: true, userId: true, scopes: true, tokenHash: true, revokedAt: true, expiresAt: true },
  });

  // The unique-index lookup already decided this; the compare re-checks it in constant time so
  // the branch does not depend on how far two digests happened to match.
  if (!record || !digestsMatch(record.tokenHash, hashMcpToken(presented))) {
    return { ok: false, failure: { reason: "INVALID" } };
  }
  // Charged *before* the revoked/expired branches, not after. Revocation is the response to a
  // leak, so a revoked token is precisely the one whose replay needs a ceiling; short-circuiting
  // first would have exempted it from the only limit in the system. It also stamps `last_used_at`
  // on refused attempts, which is how you see that someone is still trying a token you killed.
  const usage = await consumeRateLimit(record.id);
  if (!usage) return { ok: false, failure: { reason: "INVALID" } };

  if (usage.rate_count > RATE_LIMIT_MAX_REQUESTS) {
    const resetsAt = usage.window_start_epoch * 1000 + RATE_LIMIT_WINDOW_MS;
    return {
      ok: false,
      failure: {
        reason: "RATE_LIMITED",
        retryAfterSeconds: Math.max(1, Math.ceil((resetsAt - now.getTime()) / 1000)),
      },
    };
  }

  if (record.revokedAt) return { ok: false, failure: { reason: "REVOKED" } };
  if (record.expiresAt && record.expiresAt <= now) {
    return { ok: false, failure: { reason: "EXPIRED" } };
  }

  return {
    ok: true,
    tokenId: record.id,
    userId: record.userId,
    // Narrowed to scopes this build knows: a scope removed from the code must stop granting
    // access even while it is still sitting in an old row.
    scopes: parseScopes(record.scopes),
  };
};

const digestsMatch = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
};

export const MCP_RATE_LIMIT = {
  windowMs: RATE_LIMIT_WINDOW_MS,
  maxRequests: RATE_LIMIT_MAX_REQUESTS,
} as const;
