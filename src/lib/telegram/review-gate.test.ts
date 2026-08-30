import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  clearPendingScan,
  hasPendingScan,
  putPendingScan,
  takePendingScan,
  type PendingScan,
} from "@/lib/telegram/pending-scan";

/**
 * The ordering rule the confirmation step depends on.
 *
 * `handleReceiptPhoto` sends the review and only then stores the draft. This exercises that rule
 * against the real pending-scan store, because the bug it prevents is not visible in either piece
 * alone: a draft stored before an undelivered prompt is a transaction nobody has seen, waiting
 * for any bare "yes" in the next ten minutes.
 */

const draft = (over: Partial<PendingScan> = {}): PendingScan => ({
  amount: 470,
  description: "The Coffee Bean",
  categoryId: "cat_food",
  categoryName: "Food & Dining",
  date: "2026-08-01",
  labelIds: [],
  labelNames: [],
  updateId: 7,
  createdAt: Date.now(),
  ...over,
});

/** Mirrors the order in handleReceiptPhoto: deliver first, store only on success. */
const reviewThenStore = async (
  chatId: number,
  scan: PendingScan,
  send: () => Promise<boolean>
): Promise<boolean> => {
  if (!(await send())) return false;
  putPendingScan(chatId, scan);
  return true;
};

beforeEach(() => clearPendingScan(1));

describe("review before storing", () => {
  it("stores the draft when the review is delivered", async () => {
    const send = vi.fn(async () => true);
    await reviewThenStore(1, draft(), send);

    expect(send).toHaveBeenCalledOnce();
    expect(takePendingScan(1)?.amount).toBe(470);
  });

  // The bug this covers: the draft was stored before the prompt was sent, so a delivery failure
  // left a scanned transaction pending that the user had never seen. Any bare "yes" within the
  // TTL would then save it unreviewed, which defeats the entire confirmation step.
  it("stores nothing when the review cannot be delivered", async () => {
    const ok = await reviewThenStore(1, draft(), async () => false);

    expect(ok).toBe(false);
    expect(hasPendingScan(1)).toBe(false);
    expect(takePendingScan(1)).toBeNull();
  });

  it("leaves an earlier draft intact when the replacement review fails", async () => {
    // Nothing is overwritten until the new one has been shown, so the user's earlier receipt
    // survives a failed second scan rather than being silently replaced by an unseen one.
    putPendingScan(1, draft({ amount: 100, description: "Earlier receipt" }));

    await reviewThenStore(1, draft({ amount: 999, description: "Unseen" }), async () => false);

    expect(takePendingScan(1)?.description).toBe("Earlier receipt");
  });

  it("replaces an earlier draft once the replacement has been shown", async () => {
    putPendingScan(1, draft({ amount: 100, description: "Earlier receipt" }));

    await reviewThenStore(1, draft({ amount: 999, description: "Shown" }), async () => true);

    expect(takePendingScan(1)?.description).toBe("Shown");
  });
});
