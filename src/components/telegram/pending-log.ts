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
  /**
   * Which Telegram account this record belongs to.
   *
   * `sessionStorage` is per-origin, not per-person, and Telegram Desktop and Web both let one
   * browser profile hold several accounts. Without this, a record left by one account is restored
   * for the next: the retry sends *their* key with *this* account's credential, `findSavedBatch`
   * scopes to the wrong user and finds nothing, and the batch is written fresh -- so the second
   * account gets a transaction carrying the first one's description and amount.
   *
   * Not a security control; the server decides who anybody is. This only answers "is the person
   * looking at this the person who left it", which is exactly what a local draft needs to know.
   */
  scope: string;
}

/**
 * A stable tag for the account a credential belongs to.
 *
 * Read out of the raw `initData` query string rather than a parsed SDK object, because the raw
 * string is what the page holds. Untrusted by construction and that is fine: it is compared only
 * against another value from the same source, never believed about identity.
 */
export const scopeOf = (initData: string): string => {
  try {
    const user = new URLSearchParams(initData).get("user");
    if (!user) return "anonymous";
    const parsed: unknown = JSON.parse(user);
    const id = (parsed as { id?: unknown })?.id;
    return typeof id === "number" || typeof id === "string" ? String(id) : "anonymous";
  } catch {
    return "anonymous";
  }
};

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

export const readPendingLog = (scope: string): PendingLog | null =>
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

    // Somebody else's draft, or one written before records carried a scope. Ignored rather than
    // offered: retrying it would send their key with this account's credential, which writes their
    // amount and description into this ledger.
    if (candidate.scope !== scope) return null;

    return {
      clientBatchId: candidate.clientBatchId,
      description: candidate.description,
      amount: candidate.amount,
      type: candidate.type === "INCOME" ? "INCOME" : "EXPENSE",
      scope,
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
