/**
 * Decide whether a Postgres connection string points at this machine.
 *
 * Split out from the guard because it is the guard's whole judgement, and both directions of a
 * wrong answer are bad in their own way. Clearing a remote database is the accident this exists to
 * stop. Refusing a local one is not merely an annoyance: the only documented way past the guard is
 * `ALLOW_REMOTE_DB=1`, so a guard that misfires on ordinary local setups teaches the developer to
 * type the override by reflex, which removes the guard more thoroughly than deleting it would.
 *
 * It parses with `new URL` and nothing else. An earlier version tried to *repair* a URL WHATWG
 * rejected, by percent-encoding everything before the last `@` -- added because review reported the
 * guard refusing `postgres://user:pa#ss@localhost:5432/db`. That premise turned out to be wrong:
 * Prisma rejects a raw `#` or `/` in a password too, with `P1013: The provided database string is
 * invalid`, and accepts those characters only percent-encoded, which `new URL` then parses without
 * help. So the repair fixed nothing reachable, and it *introduced* a hole -- the greedy split took
 * the last `@` anywhere in the string, so
 * `postgres://user:pa/ss@prod.example/db?application_name=dev@localhost` reported `localhost` and
 * cleared the guard. A raw `@` needs no repair either; both `new URL` and Prisma read it natively.
 *
 * The rule that replaced it: if `new URL` will not parse it, Prisma will not run it, and the guard
 * refuses. Failing closed on a string nothing can use costs nobody anything.
 */

/** Hostnames that are this machine, after lower-casing. IPv6 literals keep their brackets. */
const LOCAL_NAMES = new Set(["localhost", "::1", "[::1]", "0.0.0.0", "[::]"]);

/** `127.0.0.1`, and the shorthands (`127.1`) that WHATWG leaves uncanonicalised. */
const LOOPBACK_V4 = /^127(?:\.\d{1,3}){0,3}$/;

/** Is this name, socket path or address on this machine? */
const isLocalName = (value: string): boolean => {
  const host = value.toLowerCase();
  // A socket directory is a path on this machine.
  if (host.startsWith("/")) return true;
  // `foo.localhost` resolves to loopback by convention and is common in container setups.
  return LOCAL_NAMES.has(host) || host.endsWith(".localhost") || LOOPBACK_V4.test(host);
};

/**
 * The host a Postgres URL actually connects to, lower-cased, or `null` if it cannot be determined.
 *
 * **The `host` query parameter wins over the authority.** This is not a curiosity: measured against
 * Prisma 6.19.2, `postgres://…@localhost:5432/db?host=nonexistent.invalid` prints
 * `Datasource "db": … at "localhost:5432"` and then fails with
 * `Can't reach database server at nonexistent.invalid:5432`. Prisma's own output names the host it
 * is not using, so trusting the authority here would let `postgresql://localhost/db?host=prod`
 * through the guard and straight into production. Only the lower-case `host` has this effect --
 * `hostaddr` and `HOST` were both measured to be ignored.
 */
export const databaseHost = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const override = parsed.searchParams.get("host");
  if (override !== null) return override.toLowerCase();

  return parsed.hostname.toLowerCase();
};

/**
 * True when the URL addresses a database on this machine.
 *
 * An empty host is a unix-domain socket (`postgresql:///db`), which is local by construction. A
 * host it cannot parse is never local: the guard's premise is knowing where the write lands, and
 * there it does not.
 */
export const isLocalDatabase = (url: string): boolean => {
  const host = databaseHost(url);
  if (host === null) return false;
  if (host === "") return true;
  return isLocalName(host);
};
