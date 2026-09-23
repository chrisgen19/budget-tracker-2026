/**
 * Reading a libpq connection string the way libpq reads it.
 *
 * Every bug this module exists for is the same shape: WHATWG `URL` and libpq disagree about a
 * string, the guard believes `URL`, and the connection obeys libpq. One copy, because the previous
 * two guards each held their own copy of this reasoning and each was wrong in its own way.
 */

/**
 * True when the string carries a raw `#`.
 *
 * WHATWG `URL` treats everything after the first `#` as a fragment, so `searchParams` cannot see
 * it. libpq has no notion of a fragment and keeps reading `&`-separated parameters to the end of
 * the string, keeping the **last** value for each keyword. Everything after a `#` is therefore
 * invisible to a guard and live to the connection. Measured on PostgreSQL 17.9:
 *
 *   ?sslmode=require#&sslmode=disable
 *     -> guard sees ["require"], libpq connected with ssl = f
 *
 *   postgres://u@nonexistent.invalid:5432/db?sslmode=disable&application_name=x#&host=127.0.0.1
 *     -> guard answers "nonexistent.invalid", libpq connected to 127.0.0.1
 *
 * The second is the dangerous one: it moves the destination itself, in either direction.
 *
 * Refusing rather than reimplementing libpq's parser, because a raw `#` cannot appear in a string
 * anything here can use. Prisma rejects one outright (`P1013`, as the note atop `db-host.ts`
 * records), and a `#` inside a password has to be written `%23` to survive `new URL` at all -- in
 * which case there is no fragment and this returns false. Failing closed on a string nothing can
 * use costs nobody anything.
 */
export const hasRawFragment = (url: string): boolean => url.includes("#");

/**
 * Move every password out of the connection string and into `PGPASSWORD`.
 *
 * `pg_dump` and `psql` take the string as `argv`, so a password left in it is visible to every
 * process on the machine through `ps` for the whole of the dump. `PGPASSWORD` is read from the
 * environment, which `ps` does not show.
 *
 * Both places libpq accepts a password have to be moved, not just the userinfo one. `password` is
 * an ordinary connection keyword and may be given as a query parameter, and measured on PostgreSQL
 * 17.9 it **wins over both** the userinfo password and `PGPASSWORD`:
 *
 *   postgres://u:wrong@h/db?password=right  -> authenticated
 *   postgres://u:right@h/db?password=wrong  -> password authentication failed
 *   PGPASSWORD=right, ?password=wrong       -> password authentication failed
 *
 * So a string carrying one did not merely leak it into `ps`; it also overrode the environment
 * variable this function sets, which is the whole mechanism meant to keep it out of `ps`.
 *
 * Note the asymmetric decoding, which is not an oversight: `URL` leaves `u.password`
 * percent-encoded and hands `searchParams` values back already decoded.
 */
export const splitCredentials = (url: string): { safeUrl: string; env: Record<string, string> } => {
  try {
    const u = new URL(url);
    const fromUserinfo = u.password ? decodeURIComponent(u.password) : "";
    const fromQuery = u.searchParams.getAll("password").filter((v) => v !== "");
    // The last one, for the same reason every other read here takes the last: that is libpq's.
    const password = fromQuery.length > 0 ? fromQuery[fromQuery.length - 1] : fromUserinfo;

    u.password = "";
    // Only when there is one, so a string without it is serialised exactly as before.
    if (fromQuery.length > 0) u.searchParams.delete("password");

    return { safeUrl: u.toString(), env: password ? { PGPASSWORD: password } : {} };
  } catch {
    // Unreachable through the guards, which refuse a string `new URL` cannot parse before any of
    // this runs. Kept so a future caller without that guard degrades to today's behaviour.
    return { safeUrl: url, env: {} };
  }
};
