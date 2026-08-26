/**
 * Size limits for receipt images, in a module with no imports of its own.
 *
 * Kept apart from `receipt-guard.ts` deliberately: that file pulls in the Prisma singleton and
 * `next/server`, and the MCP tool schema needs these numbers at module load. Importing the guard
 * for a constant would have instantiated a database client inside the stdio entry point, which
 * takes its Prisma instance by injection precisely so it does not do that.
 */

/** The largest image the scan pipeline accepts, decoded. */
export const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB

/**
 * The longest base64 string that can decode to a permitted image.
 *
 * Base64 costs 4 characters per 3 bytes. Callers that receive an encoded payload must check this
 * *before* decoding: `Buffer.from` allocates the whole result first, so validating only the
 * decoded length lets an oversized request be materialised in memory before it is refused.
 */
export const MAX_BASE64_LENGTH = Math.ceil(MAX_FILE_SIZE / 3) * 4;
