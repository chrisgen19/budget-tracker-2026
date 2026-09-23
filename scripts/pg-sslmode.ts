/**
 * Read the `sslmode` libpq will actually use, and refuse one that permits cleartext.
 *
 * Its own module rather than a copy in each script, for the reason `db-host.ts` and
 * `pg-version.ts` are: `backup-prod-db.ts` and `refresh-local-mirror.ts` both end in
 * `process.exit(main())`, so importing either runs it and nothing declared inside can be tested.
 * It lived in both of them verbatim, and was wrong in both, which is the argument for one copy.
 */

/**
 * The effective `sslmode`, or null when none is set.
 *
 * **The last occurrence wins, not the first.** `URLSearchParams.get` answers the first, and libpq
 * answers the last, so a string carrying both was read one way by the guard and another by the
 * connection. Measured against PostgreSQL 17.9 with `select ssl from pg_stat_ssl`:
 *
 *   sslmode=require&sslmode=disable  ->  ssl = f   (libpq took `disable`)
 *   sslmode=disable&sslmode=require  ->  ssl = t   (libpq took `require`)
 *
 * so `?sslmode=require&sslmode=disable` passed a guard reading `require` and then sent the whole
 * database in cleartext.
 *
 * Empty values are skipped rather than returned. libpq rejects one outright (`invalid sslmode
 * value: ""`), so a trailing empty cannot be used to sneak past: the worst it does is make this
 * report the last real mode, after which libpq refuses to connect at all.
 */
export const effectiveSslMode = (url: string): string | null => {
  let all: string[];
  try {
    all = new URL(url).searchParams.getAll("sslmode");
  } catch {
    return null;
  }
  const set = all.filter((v) => v !== "");
  return set.length > 0 ? set[set.length - 1] : null;
};

/**
 * Refuse a source that permits an unencrypted connection.
 *
 * `disable`, `allow` and `prefer` all send the credentials and the whole database in cleartext if
 * the server does not insist otherwise, and both callers copy an entire production database across
 * that connection. `require` and above are accepted: `require` does not authenticate the server,
 * which is a real weakness, but demanding `verify-full` would refuse the connection string this
 * deployment actually uses and needs a CA bundle to satisfy.
 */
export const sslProblem = (url: string): string | null => {
  const mode = effectiveSslMode(url);
  if (mode === null) return "no sslmode= is set, so libpq may connect in cleartext";
  if (["disable", "allow", "prefer"].includes(mode)) {
    return `sslmode=${mode} permits an unencrypted connection`;
  }
  return null;
};
