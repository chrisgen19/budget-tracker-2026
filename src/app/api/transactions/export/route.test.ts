import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  getAuthUserId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: mocks.findMany } },
}));
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

import { POST } from "@/app/api/transactions/export/route";

const tx = (id: string, description: string) => ({
  id,
  amount: 10,
  date: new Date("2026-08-28T00:00:00.000Z"),
  description,
  type: "EXPENSE",
  createdVia: "APP",
  receiptGroupId: null,
  category: { name: "Food" },
  labels: [],
  bill: null,
});
describe("POST /api/transactions/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
  });

  it("exports owned rows in the selected snapshot order", async () => {
    mocks.findMany.mockResolvedValue([tx("a", "First"), tx("b", "Second")]);
    const response = await POST(
      new Request("http://localhost/api/transactions/export", {
        method: "POST",
        body: JSON.stringify({ ids: ["b", "a", "not-owned"], timezoneOffset: -480 }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Exported-Count")).toBe("2");
    const csv = await response.text();
    expect(csv.indexOf("Second")).toBeLessThan(csv.indexOf("First"));
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", id: { in: ["b", "a", "not-owned"] } },
      }),
    );
  });

  it("rejects an empty selection", async () => {
    const response = await POST(
      new Request("http://localhost/api/transactions/export", {
        method: "POST",
        body: JSON.stringify({ ids: [], timezoneOffset: 0 }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
