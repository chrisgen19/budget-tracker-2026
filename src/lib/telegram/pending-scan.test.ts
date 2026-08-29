import { describe, expect, it, beforeEach } from "vitest";
import {
  PENDING_TTL_MS,
  clearPendingScan,
  hasPendingScan,
  isConfirmation,
  isRejection,
  putPendingScan,
  revisePendingScan,
  takePendingScan,
  type PendingScan,
} from "@/lib/telegram/pending-scan";

const scan = (over: Partial<PendingScan> = {}): PendingScan => ({
  amount: 350,
  description: "SM Supermarket",
  categoryId: "cat_food",
  categoryName: "Food & Dining",
  date: "2026-08-26",
  updateId: 42,
  createdAt: Date.now(),
  ...over,
});

beforeEach(() => {
  clearPendingScan(1);
  clearPendingScan(2);
});

describe("pending scans", () => {
  it("returns what was stored, once", () => {
    putPendingScan(1, scan());
    expect(takePendingScan(1)?.amount).toBe(350);
    // Taken, not read: a second "yes" must not save the same receipt again.
    expect(takePendingScan(1)).toBeNull();
  });

  it("keeps chats separate", () => {
    putPendingScan(1, scan({ amount: 100 }));
    putPendingScan(2, scan({ amount: 200 }));
    expect(takePendingScan(2)?.amount).toBe(200);
    expect(takePendingScan(1)?.amount).toBe(100);
  });

  it("a second scan supersedes the first, since yes would be ambiguous", () => {
    putPendingScan(1, scan({ amount: 100 }));
    putPendingScan(1, scan({ amount: 999 }));
    expect(takePendingScan(1)?.amount).toBe(999);
  });

  it("expires, so a forgotten yes cannot save something stale", () => {
    const now = Date.now();
    putPendingScan(1, scan({ createdAt: now - PENDING_TTL_MS - 1 }));
    expect(takePendingScan(1, now)).toBeNull();
  });

  it("is still valid just inside the window", () => {
    const now = Date.now();
    putPendingScan(1, scan({ createdAt: now - PENDING_TTL_MS + 1_000 }));
    expect(takePendingScan(1, now)).not.toBeNull();
  });

  it("drops an expired scan rather than leaving it for a later yes", () => {
    const now = Date.now();
    putPendingScan(1, scan({ createdAt: now - PENDING_TTL_MS - 1 }));
    expect(takePendingScan(1, now)).toBeNull();
    // Even asking again at a time when it would have been fresh must not resurrect it.
    expect(takePendingScan(1, now - PENDING_TTL_MS)).toBeNull();
  });

  // The bug this covers: a new photo cleared the pending draft before the replacement had been
  // downloaded or scanned. A failure then left nothing, and recovering the first receipt meant
  // scanning it again and spending a second credit.
  it("reports a pending scan without consuming it", () => {
    putPendingScan(1, scan());
    expect(hasPendingScan(1)).toBe(true);
    // Still there: peeking must not be what loses it.
    expect(hasPendingScan(1)).toBe(true);
    expect(takePendingScan(1)).not.toBeNull();
  });

  it("does not report an expired scan as pending", () => {
    const now = Date.now();
    putPendingScan(1, scan({ createdAt: now - PENDING_TTL_MS - 1 }));
    expect(hasPendingScan(1, now)).toBe(false);
  });

  it("reports nothing pending for an untouched chat", () => {
    expect(hasPendingScan(1)).toBe(false);
  });

  it("returns null for a chat with nothing pending", () => {
    expect(takePendingScan(99)).toBeNull();
  });
});

describe("confirmation parsing", () => {
  it("accepts the usual yeses", () => {
    for (const t of ["yes", "y", "Yes", "YEP", " ok ", "sure", "save", "confirm", "👍"]) {
      expect(isConfirmation(t), t).toBe(true);
    }
  });

  it("accepts the usual noes", () => {
    for (const t of ["no", "n", "Nope", "cancel", "discard"]) {
      expect(isRejection(t), t).toBe(true);
    }
  });

  // Anything ambiguous must fall through to normal handling, so a user who types another expense
  // instead of answering gets it logged rather than accidentally confirming the receipt.
  it("treats anything else as neither", () => {
    for (const t of ["100 lunch", "yes please save 500", "/summary", "maybe", "okay so"]) {
      expect(isConfirmation(t), t).toBe(false);
      expect(isRejection(t), t).toBe(false);
    }
  });
});

describe("revisePendingScan", () => {
  it("replaces the description and keeps the idempotency key", () => {
    // updateId derives the batch key. Changing it on a correction would let the corrected save
    // write a second row instead of replaying the photo's.
    putPendingScan(7, scan({ description: "SM Supermarket", updateId: 42 }));

    const result = revisePendingScan(7, "Groceries at SM");

    expect(result).toMatchObject({
      status: "revised",
      scan: { description: "Groceries at SM", updateId: 42, amount: 350 },
    });
    // Still waiting: a correction is not a confirmation.
    expect(hasPendingScan(7)).toBe(true);
  });

  it("refreshes the TTL, since correcting is active engagement", () => {
    const start = Date.now();
    putPendingScan(7, scan({ createdAt: start }));

    const later = start + PENDING_TTL_MS - 1_000;
    const result = revisePendingScan(7, "Groceries", later);

    expect(result).toMatchObject({ status: "revised", scan: { createdAt: later } });
    // Would have expired on the original stamp; does not on the refreshed one.
    expect(hasPendingScan(7, later + PENDING_TTL_MS - 1_000)).toBe(true);
  });

  it("returns null when nothing is waiting", () => {
    expect(revisePendingScan(999, "Groceries")).toEqual({ status: "none" });
  });

  it("returns null for an expired scan rather than reviving it", () => {
    const start = Date.now();
    putPendingScan(7, scan({ createdAt: start }));
    expect(revisePendingScan(7, "Groceries", start + PENDING_TTL_MS + 1)).toEqual({
      status: "none",
    });
  });
});

describe("a frozen scan", () => {
  it("refuses a correction, because a replay would discard it", () => {
    // The save never settled, so the row may already exist. The retry replays the same updateId
    // key: if the first write committed, the server returns the original row and any edit made in
    // between vanishes. Accepting the edit would show the user one thing and save another.
    putPendingScan(7, scan({ frozen: true }));

    expect(revisePendingScan(7, "Groceries at SM")).toEqual({ status: "frozen" });
    // Still confirmable — answering yes is what actually settles the ambiguity.
    expect(hasPendingScan(7)).toBe(true);
    expect(takePendingScan(7)?.description).toBe("SM Supermarket");
  });

  it("stays editable when the refusal was deterministic", () => {
    // A lapsed write lease is raised before anything is written, so there is nothing to replay.
    putPendingScan(7, scan({ frozen: false }));
    expect(revisePendingScan(7, "Groceries at SM")).toMatchObject({ status: "revised" });
  });
});

describe("the review message id", () => {
  it("survives a correction, so a typed answer can still clear the buttons", () => {
    // The buttons live on the original review. A correction sends a new message but leaves that
    // one in place, and answering by typing still has to take its keyboard off.
    putPendingScan(7, scan({ reviewMessageId: 555 }));

    const result = revisePendingScan(7, "Groceries at SM");

    expect(result).toMatchObject({ status: "revised", scan: { reviewMessageId: 555 } });
    expect(takePendingScan(7)?.reviewMessageId).toBe(555);
  });

  it("survives a restore after a failed save", () => {
    // confirmPendingScan puts the draft back on failure; losing the id here would leave the
    // keyboard live forever once the retry finally succeeded.
    const original = scan({ reviewMessageId: 555 });
    putPendingScan(7, { ...original, createdAt: Date.now(), frozen: true });

    expect(takePendingScan(7)?.reviewMessageId).toBe(555);
  });
});
