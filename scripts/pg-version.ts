/**
 * Compare a PostgreSQL server's version with the local `pg_dump`'s.
 *
 * Its own module rather than inline in `backup-prod-db.ts`, for the same reason `db-host.ts` and
 * `database-url.ts` are: that script ends in `process.exit(main())`, so importing it runs it, and
 * nothing declared inside it can be unit tested. The commands stay there; the rule lives here.
 */

/**
 * The major version out of whatever Postgres prints.
 *
 * Both sources embed it in prose - `show server_version` answers `17.9 (Ubuntu 17.9-1.pgdg24.04+1)`
 * and `pg_dump --version` answers `pg_dump (PostgreSQL) 17.9 (Ubuntu ...)` - and neither leading
 * word carries a digit, so the first run of digits is the major version in both.
 */
export const majorVersion = (text: string): number | null => {
  const m = text.match(/(\d+)/);
  return m ? Number(m[1]) : null;
};

/**
 * Refuse a server newer than the local `pg_dump`.
 *
 * `pg_dump` will not read a server newer than itself: it exits with "server version mismatch" and
 * writes nothing. Left to `pg_dump`, that arrives at the one moment a pre-migration backup exists
 * for, seconds before a migration, in a message that names neither version nor which half is
 * behind. The other direction is fine and deliberately allowed - a newer `pg_dump` reads an older
 * server, which is the ordinary case on a laptop tracking a distribution.
 *
 * Returns null when either version is unreadable, so a backup is never blocked over a version that
 * merely could not be determined. `pg_dump` still refuses loudly in that case; only the better
 * message is lost.
 */
export const versionSkew = (serverText: string, clientText: string): string | null => {
  const server = majorVersion(serverText);
  const client = majorVersion(clientText);
  if (server === null || client === null) return null;
  if (client >= server) return null;
  return (
    `the server is PostgreSQL ${server} and the local pg_dump is ${client}. ` +
    `pg_dump cannot read a newer server, so install postgresql-client-${server} and re-run`
  );
};
