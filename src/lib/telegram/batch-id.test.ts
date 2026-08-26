import { describe, expect, it } from "vitest";
import { z } from "zod";
import { updateBatchId } from "@/lib/telegram/batch-id";

describe("updateBatchId", () => {
  // The bug this covers: the bot sent `telegram-<updateId>`, which the create_transactions
  // schema rejects, so every logging message failed before anything was written.
  it("produces a value the clientBatchId schema accepts", () => {
    const uuid = z.string().uuid();
    for (const updateId of [0, 1, 42, 999_999, 2_147_483_647]) {
      expect(uuid.safeParse(updateBatchId("1234567890", updateId)).success).toBe(true);
    }
  });

  it("is stable for the same update, so a redelivery replays rather than duplicating", () => {
    expect(updateBatchId("1234567890", 42)).toBe(updateBatchId("1234567890", 42));
  });

  it("differs per update", () => {
    expect(updateBatchId("1234567890", 42)).not.toBe(updateBatchId("1234567890", 43));
  });

  it("differs per bot, so a reissued token's update ids cannot replay stored batches", () => {
    expect(updateBatchId("1234567890", 42)).not.toBe(updateBatchId("9876543210", 42));
  });
});
