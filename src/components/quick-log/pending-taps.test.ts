import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_TAP_TTL_MS,
  claimPendingTap,
  isReusable,
  readPendingTaps,
  releasePendingTap,
  tapSlot,
  writePendingTaps,
} from "@/components/quick-log/pending-taps";

/**
 * The correctness of one-tap logging lives here, and every rule it holds was a bug first.
 */

const NOW = 1_760_000_000_000;

beforeEach(() => {
  sessionStorage.clear();
  // Clears the module's record of whether writing works, which outlives a single test. Done
  // through the real API rather than a test-only export: a write that lands is exactly what tells
  // it storage is usable again.
  writePendingTaps({});
});

describe("tapSlot", () => {
  it("separates the same button at different amounts", () => {
    // An "ask" tile logs a different purchase each time, so replaying one figure's key under
    // another would write the wrong amount.
    expect(tapSlot("tile_1", 38)).not.toBe(tapSlot("tile_1", 45));
    expect(tapSlot("tile_1", 38)).toBe(tapSlot("tile_1", 38));
  });

  it("separates different buttons at the same amount", () => {
    // A page-scoped key was picked up by a tap on a different button and replayed the wrong row.
    expect(tapSlot("tile_1", 38)).not.toBe(tapSlot("tile_2", 38));
  });
});

describe("reuse is bounded", () => {
  it("reuses a key while a retry is still plausible", () => {
    expect(isReusable({ key: "k", at: NOW }, NOW)).toBe(true);
    expect(isReusable({ key: "k", at: NOW }, NOW + PENDING_TAP_TTL_MS)).toBe(true);
  });

  it("stops reusing it once the press is a new purchase", () => {
    // Without a boundary, an identical press hours later was treated as a retry: the server
    // replayed the original transaction and the new purchase was never recorded, while the
    // confirmation read "Already logged".
    expect(isReusable({ key: "k", at: NOW }, NOW + PENDING_TAP_TTL_MS + 1)).toBe(false);
  });

  it("is bounded in minutes, not the lifetime of the tab", () => {
    // sessionStorage outlives a reload and a day of use; the ceiling is not the boundary.
    expect(PENDING_TAP_TTL_MS).toBeLessThanOrEqual(15 * 60 * 1000);
  });
});

describe("storage", () => {
  it("survives a round trip", () => {
    writePendingTaps({ "tile_1:38": { key: "batch-1", at: NOW } });
    expect(readPendingTaps(NOW)).toEqual({ "tile_1:38": { key: "batch-1", at: NOW } });
  });

  it("drops an entry that has aged out", () => {
    writePendingTaps({ "tile_1:38": { key: "batch-1", at: NOW } });
    expect(readPendingTaps(NOW + PENDING_TAP_TTL_MS + 1)).toEqual({});
  });

  it("keeps the live entries beside an expired one", () => {
    writePendingTaps({
      old: { key: "batch-old", at: NOW },
      fresh: { key: "batch-new", at: NOW + PENDING_TAP_TTL_MS },
    });

    expect(readPendingTaps(NOW + PENDING_TAP_TTL_MS + 1)).toEqual({
      fresh: { key: "batch-new", at: NOW + PENDING_TAP_TTL_MS },
    });
  });

  it("drops anything that is not a key and a timestamp", () => {
    // A malformed entry must never become a clientBatchId: sent as one it would either replay a
    // stranger's batch lookup or be refused, and the refusal is a 4xx the client reads as proof
    // nothing was written.
    sessionStorage.setItem(
      "quick-log:pending-taps",
      JSON.stringify({
        bare: "just-a-string",
        noAt: { key: "batch" },
        badAt: { key: "batch", at: "soon" },
        nul: null,
        good: { key: "batch-ok", at: NOW },
      })
    );

    expect(readPendingTaps(NOW)).toEqual({ good: { key: "batch-ok", at: NOW } });
  });

  it("reads nothing rather than throwing on unusable storage", () => {
    sessionStorage.setItem("quick-log:pending-taps", "{not json");
    expect(readPendingTaps(NOW)).toEqual({});
  });

  it("removes the entry entirely once nothing is pending", () => {
    writePendingTaps({ "tile_1:38": { key: "batch-1", at: NOW } });
    writePendingTaps({});
    expect(sessionStorage.getItem("quick-log:pending-taps")).toBeNull();
  });
});

/**
 * Two surfaces log now -- the dashboard strip and /quick-log -- and an in-flight request outlives
 * the page that started it. Everything below covers the record they share.
 *
 * There is no per-caller copy to pass in any more, and that is the point rather than a tidy-up:
 * three separate bugs on #276 all came from one, and the shapes they took are pinned here so the
 * next attempt to reintroduce it is caught by the failure it causes rather than by review.
 */
describe("the shared record", () => {
  it("keeps a slot another surface claimed while this tap was in flight", () => {
    // Round one. The dashboard claims A and the user follows the Manage link; /quick-log claims B;
    // the dashboard's request then settles. Computed from the snapshot it was holding, that
    // release wrote {A} back as {} and B's key was gone -- so the next press of B posted a fresh
    // key for a write that may already have committed.
    claimPendingTap("A", NOW);
    const b = claimPendingTap("B", NOW);

    const after = releasePendingTap("A", NOW);

    expect(after).not.toHaveProperty("A");
    expect(after.B).toEqual(b.taps.B);
    expect(readPendingTaps(NOW).B).toEqual(after.B);
  });

  it("never brings back a slot that has been settled", () => {
    // Round two. A copy taken before the settle still held X, and a later claim on a *different*
    // tile merged it back in; the next genuine press of X then reused a completed key, replayed
    // the finished transaction and was answered "Already logged" -- the invisible failure this
    // file is written to avoid. Nothing holds a copy to merge now, and that is what closed it.
    const settled = claimPendingTap("X:38", NOW);
    releasePendingTap("X:38", NOW);

    claimPendingTap("Y:120", NOW);

    expect(readPendingTaps(NOW)).not.toHaveProperty("X:38");
    expect(claimPendingTap("X:38", NOW).key).not.toBe(settled.key);
  });

  it("hands a second surface the key the first one claimed", () => {
    const first = claimPendingTap("A", NOW);
    // A freshly mounted page. It carries nothing, and needs to carry nothing.
    const second = claimPendingTap("A", NOW);

    expect(second.key).toBe(first.key);
  });

  it("mints a new key once the window has passed, since that press is a new purchase", () => {
    const first = claimPendingTap("A", NOW);
    const later = claimPendingTap("A", NOW + PENDING_TAP_TTL_MS + 1);

    expect(later.key).not.toBe(first.key);
  });

  it("returns the record it wrote", () => {
    const claimed = claimPendingTap("A", NOW);
    expect(claimed.taps).toEqual(readPendingTaps(NOW));

    const released = releasePendingTap("A", NOW);
    expect(released).toEqual(readPendingTaps(NOW));
  });
});

/**
 * A browser that will not store anything still has to not duplicate anything. Reload-safety is the
 * documented cost of these; the retry is not.
 */
describe("when storage is not a record", () => {
  const blockReads = () =>
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
  const blockWrites = () =>
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

  it("still reuses a key when storage refuses to answer", () => {
    // A private window, or blocked site data.
    const first = claimPendingTap("A", NOW);
    blockReads();

    expect(claimPendingTap("A", NOW).key).toBe(first.key);
  });

  it("still reuses a key when storage can be read but not written", () => {
    // Round three, and the one shape `main` never had: legacy Safari private mode answers
    // `getItem` and throws on `setItem`, so on a read-only judgement the store looks *available
    // and empty* and the claim was thrown away.
    blockWrites();

    const first = claimPendingTap("X:38", NOW);
    const retry = claimPendingTap("X:38", NOW);

    expect(retry.key).toBe(first.key);
  });

  it("hands an unwritten claim to the other surface too", () => {
    // Round four. With the record held per component, a surface mounting after the failed write
    // read the still-empty store, started with nothing, and minted a second key for a tap that may
    // already have committed. Module scope is what fixed it: there is one record per tab, and a
    // surface does not have to be handed it.
    blockWrites();
    const dashboard = claimPendingTap("X:38", NOW);

    // /quick-log, mounting fresh with no state of its own.
    expect(claimPendingTap("X:38", NOW).key).toBe(dashboard.key);
  });

  it("does not carry an aged-out slot forward", () => {
    // The only path where the in-memory record is read, and so the only path where anything has to
    // apply the TTL to it: `readStore` filters what it returns, the in-memory copy is filtered by
    // nobody.
    claimPendingTap("old", NOW);
    blockReads();

    const after = claimPendingTap("new", NOW + PENDING_TAP_TTL_MS + 1).taps;

    expect(after).not.toHaveProperty("old");
  });

  it("goes back to the durable record once a write lands", () => {
    // Self-healing, and it works because a write is the *whole* record rather than a patch: one
    // that succeeds resynchronises storage completely.
    const spy = blockWrites();
    const stranded = claimPendingTap("X:38", NOW);

    spy.mockRestore();
    releasePendingTap("X:38", NOW);

    expect(claimPendingTap("X:38", NOW).key).not.toBe(stranded.key);
  });
});
