import { describe, expect, it, beforeEach } from "vitest";
import {
  PENDING_TTL_MS,
  clearPendingScan,
  hasPendingScan,
  isConfirmation,
  isRejection,
  putPendingScan,
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
