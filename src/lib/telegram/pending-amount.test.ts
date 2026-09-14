import { describe, expect, it } from "vitest";
import {
  PENDING_AMOUNT_TTL_MS,
  clearPendingAmount,
  putPendingAmount,
  takePendingAmount,
} from "@/lib/telegram/pending-amount";

const prompt = (label: string, createdAt = 1_000) => ({
  source: { kind: "tile" as const, tileId: label },
  label,
  createdAt,
});

describe("pending amount prompts", () => {
  it("hands back the prompt once, then nothing", () => {
    putPendingAmount(1, prompt("grab"));
    expect(takePendingAmount(1, 1_000)?.label).toBe("grab");
    expect(takePendingAmount(1, 1_000)).toBeNull();
  });

  it("keeps one prompt per chat, and the latest tap wins", () => {
    putPendingAmount(2, prompt("grab"));
    putPendingAmount(2, prompt("lunch"));
    putPendingAmount(3, prompt("taxi"));
    expect(takePendingAmount(2, 1_000)?.label).toBe("lunch");
    expect(takePendingAmount(3, 1_000)?.label).toBe("taxi");
  });

  // A number typed long after the tap must not be filed under a button the user forgot about.
  it("expires, and an expired prompt is not picked up later", () => {
    putPendingAmount(4, prompt("grab", 0));
    expect(takePendingAmount(4, PENDING_AMOUNT_TTL_MS + 1)).toBeNull();
    expect(takePendingAmount(4, 0)).toBeNull();
  });

  it("is still answerable at the edge of the window", () => {
    putPendingAmount(5, prompt("grab", 0));
    expect(takePendingAmount(5, PENDING_AMOUNT_TTL_MS)?.label).toBe("grab");
  });

  // A Frequent entry has no id to re-read, so the snapshot has to come back whole.
  it("hands back a Frequent entry's snapshot intact", () => {
    const source = { kind: "frequent" as const, description: "Jollibee lunch", categoryId: "cat_food" };
    putPendingAmount(7, { source, label: "Jollibee lunch", createdAt: 1_000 });
    expect(takePendingAmount(7, 1_000)?.source).toEqual(source);
  });

  it("can be dropped without answering", () => {
    putPendingAmount(6, prompt("grab"));
    clearPendingAmount(6);
    expect(takePendingAmount(6, 1_000)).toBeNull();
  });
});
