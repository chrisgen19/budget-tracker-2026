/**
 * The idempotency key's lifecycle across a failure, a reload, and a retry.
 *
 * The rule is the multi-scan review's, applied to one tap: a key is minted when a tap begins, held
 * across an *unknown* outcome so the retry replays it, and cleared once a save lands or is proven
 * not to have happened. Getting this wrong writes somebody's money twice.
 *
 * The wrinkle the bot does not have: there is no `update_id` to derive a stable key from, and
 * Telegram can reload the webview at any moment. So the pending key outlives the page in
 * `sessionStorage`, and a restored one is *offered* rather than replayed. Auto-replaying on mount
 * is the tempting shortcut and it writes a row for someone who may have deliberately backed out.
 */

const STORAGE_KEY = "tg:pending-log";

export interface PendingLog {
  clientBatchId: string;
  description: string;
  amount: number;
  tileId?: string;
  categoryId?: string;
  type: "EXPENSE" | "INCOME";
}

/**
 * Every access is wrapped: `sessionStorage` throws outright in some contexts (a webview with site
 * data blocked, a private window), and a logging app must not fail to open because it could not
 * remember a draft.
 */
const safely = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const readPendingLog = (): PendingLog | null =>
  safely(() => {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const candidate = parsed as Partial<PendingLog>;
    // Validated rather than cast. This value survived a reload and may have been written by an
    // older build, and a malformed one would be posted as a transaction.
    if (
      typeof candidate.clientBatchId !== "string" ||
      typeof candidate.description !== "string" ||
      typeof candidate.amount !== "number" ||
      !Number.isFinite(candidate.amount) ||
      candidate.amount <= 0
    ) {
      return null;
    }

    return {
      clientBatchId: candidate.clientBatchId,
      description: candidate.description,
      amount: candidate.amount,
      type: candidate.type === "INCOME" ? "INCOME" : "EXPENSE",
      ...(typeof candidate.tileId === "string" ? { tileId: candidate.tileId } : {}),
      ...(typeof candidate.categoryId === "string" ? { categoryId: candidate.categoryId } : {}),
    };
  }, null);

export const writePendingLog = (pending: PendingLog): void => {
  safely(() => window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending)), undefined);
};

export const clearPendingLog = (): void => {
  safely(() => window.sessionStorage.removeItem(STORAGE_KEY), undefined);
};

/**
 * A fresh key per tap.
 *
 * `crypto.randomUUID` needs a secure context, which a Telegram webview on https always is. The
 * fallback exists for plain `http://localhost` during development, where the API rejects a
 * malformed key rather than accepting a weak one, so it only has to be shaped like a v4 UUID.
 */
export const newBatchId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
