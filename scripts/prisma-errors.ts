/**
 * Recognise the one database error a caller is allowed to treat as "not there yet".
 *
 * Prisma reports every raw-query failure as the same `P2010` ("Raw query failed") and puts the
 * driver's own code in `meta.code`, so the Prisma code alone distinguishes nothing. Postgres
 * `42P01` is `undefined_table`.
 *
 * The narrowness is the point. A bare `catch` around a schema probe also swallows an unreachable
 * host (`PrismaClientInitializationError`, no code at all), a refused login and a permission
 * denial, and reports every one of them as an empty database that needs no checking. A drift check
 * that passes when it cannot see the database is the failure it was written to prevent.
 */

/** True only for Postgres `42P01` (undefined_table) surfaced through a Prisma raw query. */
export const isMissingTableError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;

  const { code, meta } = error as { code?: unknown; meta?: unknown };
  if (code !== "P2010") return false;
  if (typeof meta !== "object" || meta === null) return false;

  return (meta as { code?: unknown }).code === "42P01";
};
