"use client";

/**
 * The idempotency key for a tap that has not settled, and how long it stays reusable.
 *
 * A key is kept across a failure and replayed rather than regenerated, because a 5xx or a lost
 * response means the write may have committed: posting again under a fresh key would write a
 * second row. A 4xx releases it, since the route raises those before it opens a transaction, so
 * nothing was written and the next attempt is a genuinely new intent.
 *
 * Lives here rather than in the page for the same reason `pending-log.ts` does for the Mini App:
 * this is the whole correctness of one-tap logging, and it needs to be testable without a page.
 */

/**
 * Where unresolved taps are held across a reload.
 *
 * `sessionStorage` rather than `localStorage`, so a key cannot outlive the tab -- but that is a
 * ceiling, not a boundary. A tab lives for days, and treating every future identical press as a
 * retry of a days-old failure is how a real purchase gets swallowed: the server replays the
 * original row and the confirmation reads "Already logged".
 *
 * Unscoped by user on purpose. A slot is keyed by tile id, tile ids are globally unique, and they
 * are never shared between accounts, so a leftover entry from a previous login can match nothing.
 */
const PENDING_TAPS_KEY = "quick-log:pending-taps";

/**
 * How long a key stays reusable.
 *
 * This is the boundary between "I am pressing it again because that failed" and "I am buying the
 * same thing again". A retry is a human reaction to an error message and happens in seconds; five
 * minutes is generous for that and nowhere near the hours a tab stays open.
 *
 * Deliberately short rather than generous, because the two mistakes do not cost the same. Past
 * the window a genuine retry writes a **duplicate**, which is visible in the ledger and
 * deletable. Inside it, a genuine new purchase is **swallowed** and reported as already logged,
 * which is invisible. The same asymmetry `frequent-tiles.ts` and `bill-writes.ts` both reason
 * from: prefer the visible mistake.
 */
export const PENDING_TAP_TTL_MS = 5 * 60 * 1000;

/**
 * Identity of a tap: the same button for the same figure is the same intent.
 *
 * The amount is part of it because an "ask" tile logs a different purchase each time, and
 * replaying one figure's key under another would write the wrong amount.
 */
export const tapSlot = (tileId: string, amount: number): string => `${tileId}:${amount}`;

/** A claimed key and when it was claimed, so reuse can be bounded. */
export interface PendingTap {
  key: string;
  at: number;
}

/** Whether a held key is still plausibly a retry rather than a new purchase. */
export const isReusable = (tap: PendingTap, now: number): boolean =>
  now - tap.at <= PENDING_TAP_TTL_MS;

/**
 * Every read and write is guarded: a private window or blocked site data throws on access.
 *
 * Expired and malformed entries are dropped on read, which is also what keeps the map from
 * accumulating: a tap whose fate is never resolved would otherwise sit there for the life of the
 * tab.
 */
/**
 * The stored record, **and whether storage answered at all**.
 *
 * The second half is the whole reason this is separate from `readPendingTaps`. An empty record and
 * a browser that refuses storage are the same `{}` to a caller, and they call for opposite
 * behaviour: an empty answer from working storage is authoritative and means every slot really is
 * settled, while a refusal means we know nothing and a caller's own copy is all there is. Reading
 * them as one value is what let a settled tap be resurrected (#276).
 */
const readStore = (
  now: number
): { taps: Record<string, PendingTap>; available: boolean } => {
  try {
    const raw = sessionStorage.getItem(PENDING_TAPS_KEY);
    if (!raw) return { taps: {}, available: true };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { taps: {}, available: true };

    const live: Record<string, PendingTap> = {};
    for (const [slot, value] of Object.entries(parsed as Record<string, unknown>)) {
      // Shape-checked rather than trusted: a malformed entry must not become a clientBatchId.
      if (typeof value !== "object" || value === null) continue;
      const { key, at } = value as { key?: unknown; at?: unknown };
      if (typeof key !== "string" || typeof at !== "number") continue;
      if (!isReusable({ key, at }, now)) continue;
      live[slot] = { key, at };
    }
    return { taps: live, available: true };
  } catch {
    return { taps: {}, available: false };
  }
};

export const readPendingTaps = (now = Date.now()): Record<string, PendingTap> =>
  readStore(now).taps;

export const writePendingTaps = (taps: Record<string, PendingTap>) => {
  try {
    if (Object.keys(taps).length === 0) sessionStorage.removeItem(PENDING_TAPS_KEY);
    else sessionStorage.setItem(PENDING_TAPS_KEY, JSON.stringify(taps));
  } catch {
    // Storage being unavailable costs the reload-safety, not the tap.
  }
};

/**
 * Drop anything a caller has held past the window, so a stale slot cannot be written back.
 *
 * Only reachable when storage is unavailable, which is also the only time nothing else applies the
 * TTL: `readStore` filters on the way out, a held copy has been filtered by nobody.
 */
const stillLive = (
  taps: Record<string, PendingTap>,
  now: number
): Record<string, PendingTap> =>
  Object.fromEntries(Object.entries(taps).filter(([, tap]) => isReusable(tap, now)));

/**
 * The shared record, as it stands right now.
 *
 * When storage answers it is the **whole** record and a caller's copy is ignored outright, not
 * merged behind it. Merging looked equivalent and is not: a mirror copied at mount keeps slots
 * that storage has since *settled*, and writing one of those back resurrects a completed
 * idempotency key. The next genuine press of that tile then replays the finished transaction and
 * is answered "Already logged" -- a purchase silently lost, which is the failure this file trades
 * against a visible duplicate everywhere else (#276).
 *
 * `held` stands in only when storage **refuses to answer** -- a private window, or blocked site
 * data -- where there is no shared record to be authoritative and the caller's copy is the only
 * thing keeping a retry from minting a second key. Losing reload-safety there is the documented
 * cost; losing the retry within one page as well is not.
 */
const currentTaps = (
  held: Record<string, PendingTap>,
  now: number
): Record<string, PendingTap> => {
  const { taps, available } = readStore(now);
  return available ? taps : stillLive(held, now);
};

/**
 * Claim the key for one tap, against the record as it stands rather than a caller's snapshot.
 *
 * The read-modify-write is the whole point, and it is here rather than in the hook because the
 * hook cannot hold the record: `useQuickTap` is mounted per surface, and an in-flight `runLog`
 * outlives the page that started it. A dashboard tap that settles after the user has followed the
 * Manage link would otherwise write its own stale copy back over storage and delete a key
 * `/quick-log` had claimed in between -- and the press that comes after a failure is then a *new*
 * key for a write that may already have committed, which is the duplicate this file exists to
 * prevent. Reported on #276.
 *
 * Returns the record it wrote, so the caller's mirror never lags what is durable.
 */
export const claimPendingTap = (
  held: Record<string, PendingTap>,
  slot: string,
  now = Date.now()
): { key: string; taps: Record<string, PendingTap> } => {
  const taps = currentTaps(held, now);

  // Everything in `taps` is inside the window already, so a hit here is by definition still
  // plausibly a retry rather than a new purchase.
  const existing = taps[slot];
  if (existing) return { key: existing.key, taps };

  const claimed: PendingTap = { key: crypto.randomUUID(), at: now };
  const next = { ...taps, [slot]: claimed };
  writePendingTaps(next);
  return { key: claimed.key, taps: next };
};

/**
 * Settle one tap, leaving every other surface's claims where they are.
 *
 * The half that was actually losing writes: a release computed from a stale snapshot removes the
 * slot it meant to *and* silently drops every slot claimed since that snapshot was taken.
 */
export const releasePendingTap = (
  held: Record<string, PendingTap>,
  slot: string,
  now = Date.now()
): Record<string, PendingTap> => {
  const { [slot]: _settled, ...rest } = currentTaps(held, now);
  writePendingTaps(rest);
  return rest;
};
