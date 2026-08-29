import { describe, expect, it, vi } from "vitest";
import { confirmPendingScan } from "@/lib/telegram/confirm-scan";
import { McpToolError, UnconfirmedWriteError } from "@/lib/telegram/errors";
import type { PendingScan } from "@/lib/telegram/pending-scan";

const SCAN: PendingScan = {
  amount: 350,
  description: "SM Supermarket",
  categoryId: "cat_food",
  categoryName: "Food & Dining",
  date: "2026-08-26",
  updateId: 42,
  createdAt: Date.now(),
};

type Save = (key: string, scan: PendingScan) => Promise<{ transactions: unknown[] }>;

const deps = (save: Save) => {
  const restore = vi.fn();
  return {
    restore,
    deps: { save, restore, batchKey: (s: PendingScan) => `key-${s.updateId}` },
  };
};

describe("confirmPendingScan", () => {
  it("reports a save that landed", async () => {
    const { deps: d, restore } = deps(vi.fn(async () => ({ transactions: [{ id: "tx_1" }] })));
    const outcome = await confirmPendingScan(SCAN, d);

    expect(outcome.status).toBe("saved");
    expect(restore).not.toHaveBeenCalled();
  });

  it("keys the write off the photo's update, so a retried yes replays", async () => {
    const save = vi.fn(async () => ({ transactions: [{ id: "tx_1" }] }));
    const { deps: d } = deps(save);
    await confirmPendingScan(SCAN, d);
    expect(save).toHaveBeenCalledWith("key-42", SCAN);
  });

  // The bug this covers: takePendingScan deletes on read, so a failed save consumed the scan.
  // The user had to send the photo again, which spends another scan credit for information they
  // had already paid for.
  it("puts the scan back when the server refuses the write", async () => {
    const { deps: d, restore } = deps(
      vi.fn(async () => {
        throw new McpToolError("Writes are currently switched off for this account.");
      })
    );

    await expect(confirmPendingScan(SCAN, d)).rejects.toThrow(McpToolError);
    // Not frozen: the server refused before opening a transaction, so nothing was written and the
    // draft is still safe to edit before the retry.
    expect(restore).toHaveBeenCalledWith(SCAN, { frozen: false });
  });

  // The likeliest trigger in practice: mcp_writes_enabled_until is a lease and lapses by design,
  // so confirming just after it expired must not cost the user their scan.
  it("rethrows so the caller can relay the server's own reason", async () => {
    const err = new McpToolError("Turn writes on in Profile > MCP Access.");
    const { deps: d } = deps(
      vi.fn(async () => {
        throw err;
      })
    );
    await expect(confirmPendingScan(SCAN, d)).rejects.toBe(err);
  });

  // Restoring is safe here specifically because the key is stable: replaying it returns the
  // original rows rather than writing a second copy.
  it("puts the scan back when the write outcome is unknown", async () => {
    const { deps: d, restore } = deps(
      vi.fn(async () => {
        throw new UnconfirmedWriteError("unresolved");
      })
    );

    await expect(confirmPendingScan(SCAN, d)).rejects.toThrow(UnconfirmedWriteError);
    // Frozen: the row may already exist, and the retry replays this same key. An edit made in
    // between would be silently discarded by the replay, so it must not be accepted.
    expect(restore).toHaveBeenCalledWith(SCAN, { frozen: true });
  });

  it("puts the scan back when the batch comes back empty", async () => {
    const { deps: d, restore } = deps(vi.fn(async () => ({ transactions: [] })));
    const outcome = await confirmPendingScan(SCAN, d);

    expect(outcome.status).toBe("retryable");
    expect(restore).toHaveBeenCalledWith(SCAN, { frozen: false });
  });
});
