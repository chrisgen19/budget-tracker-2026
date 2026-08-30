import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { MAX_BULK_TRANSACTIONS } from "@/lib/transaction-bulk";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  getAuthUserId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findMany: mocks.findMany } },
}));
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

import { POST } from "@/app/api/transactions/selection/route";

const request = (overrides: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/transactions/selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters: {
        search: "shop",
        type: "EXPENSE",
        month: "2026-08",
        categoryId: null,
        labelId: null,
        createdVia: "ALL",
        amountMin: null,
        amountMax: null,
        sortBy: "date",
        sortDir: "desc",
      },
      timezoneOffset: -480,
      ...overrides,
    }),
  });

describe("POST /api/transactions/selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.findMany.mockResolvedValue([
      { id: "tx-1", description: "Shop", type: "EXPENSE", amount: 12 },
    ]);
  });

  it("materializes an ordered snapshot scoped to the authenticated user", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ count: 1 });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1", type: "EXPENSE" }),
        take: MAX_BULK_TRANSACTIONS + 1,
      }),
    );
  });

  it("refuses snapshots above the interactive ceiling", async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: MAX_BULK_TRANSACTIONS + 1 }, (_, index) => ({
        id: `tx-${index}`,
        description: "",
        type: "EXPENSE",
        amount: 1,
      })),
    );
    const response = await POST(request());
    expect(response.status).toBe(413);
  });

  it("rejects invalid filters before querying", async () => {
    const response = await POST(request({ timezoneOffset: 9_999 }));
    expect(response.status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns the authentication response before accessing transactions", async () => {
    mocks.getAuthUserId.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
