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
 * the page that started it. These cover the rule that follows from that: a claim or a release
 * settles against the record as it stands, never against the snapshot the caller was holding.
 */
describe("claiming and releasing across surfaces", () => {
  it("keeps a key that another surface claimed after this caller's snapshot", () => {
    // The reported bug. The dashboard claims A and the user follows the Manage link; /quick-log
    // claims B; the dashboard's request then settles holding a snapshot that predates B.
    const dashboardHeld = claimPendingTap({}, "A", NOW).taps;
    claimPendingTap(dashboardHeld, "B", NOW);

    const after = releasePendingTap(dashboardHeld, "A", NOW);

    expect(after).not.toHaveProperty("A");
    // Before the fix this wrote the stale {A} back as {}, and B's key was gone. The next press of
    // B then posted a fresh key for a write that may already have committed.
    expect(after.B).toBeDefined();
    expect(readPendingTaps(NOW).B).toEqual(after.B);
  });

  it("reuses a key claimed by the other surface rather than minting a second one", () => {
    const first = claimPendingTap({}, "A", NOW);
    // A caller that has never seen this slot: a freshly mounted page, holding nothing.
    const second = claimPendingTap({}, "A", NOW);

    expect(second.key).toBe(first.key);
  });

  it("mints a new key once the window has passed, since that press is a new purchase", () => {
    const first = claimPendingTap({}, "A", NOW);
    const later = claimPendingTap({}, "A", NOW + PENDING_TAP_TTL_MS + 1);

    expect(later.key).not.toBe(first.key);
  });

  it("treats an empty answer from working storage as authoritative", () => {
    // The rule the resurrection bug came from getting wrong. Storage answering `{}` means every
    // slot really is settled, and is nothing like storage refusing to answer -- a caller's copy
    // does not get to override it.
    const held = { "X:38": { key: "batch-held", at: NOW } };

    expect(claimPendingTap(held, "X:38", NOW).key).not.toBe("batch-held");
  });

  it("does not carry a caller's aged-out slot forward when storage is unavailable", () => {
    // The only path where `held` is consulted at all, and so the only path where anything has to
    // apply the TTL to it: `readStore` filters what it returns, a held copy has been filtered by
    // nobody.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const stale = { old: { key: "batch-old", at: NOW } };

    const after = claimPendingTap(stale, "new", NOW + PENDING_TAP_TTL_MS + 1).taps;

    expect(after).not.toHaveProperty("old");
  });

  it("returns the record it wrote, so a caller's mirror cannot lag it", () => {
    const claimed = claimPendingTap({}, "A", NOW);
    expect(claimed.taps).toEqual(readPendingTaps(NOW));

    const released = releasePendingTap(claimed.taps, "A", NOW);
    expect(released).toEqual(readPendingTaps(NOW));
  });

  it("still hands back a reusable key when storage refuses to answer", () => {
    // A private window or blocked site data. Reload-safety is the documented cost there; losing
    // the retry within one page as well would turn a failed tap into a duplicate, so the caller's
    // own copy stands in.
    const held = { A: { key: "batch-held", at: NOW } };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(claimPendingTap(held, "A", NOW).key).toBe("batch-held");
  });
});

describe("a settled slot must not come back", () => {
  it("does not resurrect a tap that storage has already settled", () => {
    // Reported on #276 against the first fix. /quick-log mounts while a dashboard tap is in
    // flight, so its mirror copies that slot; the dashboard's request then settles and storage
    // drops it. A later claim on a *different* tile merged the mirror back in and rewrote the
    // settled slot, so the next genuine press of the original tile reused a completed key and was
    // answered "Already logged" -- the invisible failure this file is written to avoid.
    const settled = claimPendingTap({}, "X:38", NOW);
    const mirror = settled.taps; // what the second surface copied at mount
    releasePendingTap(settled.taps, "X:38", NOW); // the first tap finishes

    claimPendingTap(mirror, "Y:120", NOW); // a tap on another tile, holding the stale mirror

    expect(readPendingTaps(NOW)).not.toHaveProperty("X:38");
    // And the consequence, stated directly: pressing the original tile again is a new purchase.
    expect(claimPendingTap(mirror, "X:38", NOW).key).not.toBe(settled.key);
  });
});

describe("storage that can be read but not written", () => {
  it("keeps reusing this caller's own key", () => {
    // Legacy Safari private mode is the documented case: `getItem` works and `setItem` throws.
    // Judging availability on the read alone ignored the mirror here, so a retry after an unknown
    // outcome minted a second key and duplicated a row that may already have committed. `main`
    // did not have this hole -- it claimed from the mirror and never consulted storage.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const first = claimPendingTap({}, "X:38", NOW);
    const retry = claimPendingTap(first.taps, "X:38", NOW);

    expect(retry.key).toBe(first.key);
  });

  it("goes back to trusting the shared record once a write lands", () => {
    // Self-healing, and it works because a write is the *whole* record rather than a patch: one
    // that succeeds resynchronises storage completely, so the mirror is redundant again.
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const stranded = claimPendingTap({}, "X:38", NOW);

    spy.mockRestore();
    releasePendingTap(stranded.taps, "X:38", NOW);

    // Settled, and the mirror must not bring it back.
    expect(claimPendingTap(stranded.taps, "X:38", NOW).key).not.toBe(stranded.key);
  });
});
