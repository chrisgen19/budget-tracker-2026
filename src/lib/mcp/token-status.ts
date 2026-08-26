/** Accepts either a Prisma row (Date) or a serialised record (ISO string). */
type Timestamp = Date | string | null | undefined;

const asTime = (value: Timestamp): number | null => {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Whether a token can no longer be used, for any reason.
 *
 * Revocation and expiry are different events with the same consequence, and both halves of the
 * app need that consequence. Defining it twice is what let them disagree: the list treated an
 * expired token as dead and offered only Delete, while the delete endpoint asked specifically for
 * `revoked_at`, so an expired-but-never-revoked token could be neither revoked (no button) nor
 * deleted (409). One definition, imported by both, removes the class rather than the instance.
 *
 * Deliberately dependency-free so the client component can import it too.
 */
export const isTokenDead = (
  token: { revokedAt?: Timestamp; expiresAt?: Timestamp },
  now = Date.now()
): boolean => {
  if (asTime(token.revokedAt) !== null) return true;

  const expires = asTime(token.expiresAt);
  return expires !== null && expires <= now;
};
