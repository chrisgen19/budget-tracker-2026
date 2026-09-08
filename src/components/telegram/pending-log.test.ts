import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingLog,
  newBatchId,
  readPendingLog,
  writePendingLog,
} from "@/components/telegram/pending-log";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("pending log storage", () => {
  it("survives a round trip", () => {
    // The whole point: Telegram can reload the webview mid-save, and the key has to outlive the
    // page or the retry writes a second row.
    writePendingLog({
      clientBatchId: "11111111-2222-4333-8444-555555555555",
      description: "fare to office",
      amount: 38,
      type: "EXPENSE",
      tileId: "tile_1",
    });

    expect(readPendingLog()).toEqual({
      clientBatchId: "11111111-2222-4333-8444-555555555555",
      description: "fare to office",
      amount: 38,
      type: "EXPENSE",
      tileId: "tile_1",
    });
  });

  it("reads nothing when there is nothing pending", () => {
    expect(readPendingLog()).toBeNull();
  });

  it("clears", () => {
    writePendingLog({ clientBatchId: "x", description: "y", amount: 1, type: "EXPENSE" });
    clearPendingLog();

    expect(readPendingLog()).toBeNull();
  });
});

describe("pending log validation", () => {
  // This value survived a reload and may have been written by an older build. Anything malformed
  // reaching `postLog` would be posted as a transaction, so a bad record reads as no record.
  const stored = (value: string) => window.sessionStorage.setItem("tg:pending-log", value);

  it("rejects a record that is not JSON", () => {
    stored("not json");

    expect(readPendingLog()).toBeNull();
  });

  it("rejects a missing key", () => {
    stored(JSON.stringify({ description: "x", amount: 1 }));

    expect(readPendingLog()).toBeNull();
  });

  it("rejects a non-positive or non-finite amount", () => {
    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      stored(JSON.stringify({ clientBatchId: "k", description: "x", amount }));
      expect(readPendingLog()).toBeNull();
    }
  });

  it("rejects an amount that is not a number", () => {
    stored(JSON.stringify({ clientBatchId: "k", description: "x", amount: "38" }));

    expect(readPendingLog()).toBeNull();
  });

  it("defaults an unrecognised type to EXPENSE rather than passing it through", () => {
    stored(JSON.stringify({ clientBatchId: "k", description: "x", amount: 1, type: "NONSENSE" }));

    expect(readPendingLog()?.type).toBe("EXPENSE");
  });

  it("survives storage throwing outright", () => {
    // Some webviews block site data and `sessionStorage` access throws rather than returning null.
    // A logging app must not fail to open because it could not remember a draft.
    const boom = vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(readPendingLog()).toBeNull();
    expect(() => clearPendingLog()).not.toThrow();

    boom.mockRestore();
  });
});

describe("newBatchId", () => {
  it("is a v4 UUID the API will accept", () => {
    // `clientBatchIdSchema` is `z.string().uuid()`, so a weak fallback would be refused with a 400
    // rather than silently accepted.
    expect(newBatchId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("is different every time", () => {
    expect(newBatchId()).not.toBe(newBatchId());
  });
});
