/**
 * A short, credential-free description of whichever database a CLI script is about to touch.
 *
 * These scripts are run by hand against whichever database `DATABASE_URL` happens to name, and
 * the same command is used for local and for production. Their output alone cannot tell the two
 * apart: category and user ids are cuids, which differ between databases but identify neither.
 * An operator told to "check this is the right database" had no way to do it.
 *
 * Only host, port and database name are returned. Username and password are dropped rather than
 * masked, because this string is printed to a terminal and pasted into issues.
 */
export const describeDatabaseUrl = (url: string | undefined): string => {
  if (!url) return "unknown (DATABASE_URL is not set)";

  try {
    const parsed = new URL(url);
    const host = parsed.hostname || "unknown-host";
    const port = parsed.port || "5432";
    const name = parsed.pathname.replace(/^\//, "") || "unknown-db";
    return `${host}:${port}/${name}`;
  } catch {
    // Never surface the raw value: a malformed URL still usually contains the password.
    return "unparseable DATABASE_URL";
  }
};
