import { beforeEach, describe, expect, it, vi } from "vitest";

const { settleBill } = vi.hoisted(() => ({
  settleBill: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getAuthUserId: async () => "user_1",
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async () => ({ timezoneOffset: -480 }) },
  },
}));

vi.mock("@/lib/bill-writes", () => ({ settleBill }));

import { POST } from "./route";

const post = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/bills/bill_1/action", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "bill_1" }) },
  );

const payExisting = {
  action: "pay_existing",
  dueDate: "2026-09-05T00:00:00.000Z",
  transactionId: "tx_1",
};

describe("POST /api/bills/[id]/action", () => {
  beforeEach(() => {
    settleBill.mockReset();
    settleBill.mockResolvedValue({ ok: true });
  });

  // The schema strips unknown keys, so a field missing there would quietly restore the window.
  it("passes createdForOccurrence through to settleBill", async () => {
    const response = await post({ ...payExisting, createdForOccurrence: true });

    expect(response.status).toBe(200);
    expect(settleBill).toHaveBeenCalledWith(
      expect.objectContaining({ createdForOccurrence: true }),
    );
  });

  it("leaves the window on when the caller does not claim a new payment", async () => {
    await post(payExisting);

    expect(settleBill.mock.calls[0][0].createdForOccurrence).toBeUndefined();
  });
});
