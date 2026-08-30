import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getAuthUserId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

import { GET } from "@/app/api/transactions/[id]/route";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/transactions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.findFirst.mockResolvedValue({ id: "tx-1", description: "Groceries" });
  });

  it("validates and scopes the lookup to the authenticated user", async () => {
    const response = await GET(new Request("http://localhost/api/transactions/tx-1"), context("tx-1"));

    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tx-1", userId: "user-1" } }),
    );
  });

  it("rejects invalid IDs before querying", async () => {
    const response = await GET(new Request("http://localhost/api/transactions/invalid"), context(""));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid transaction ID" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("returns a generic JSON error when the lookup fails", async () => {
    mocks.findFirst.mockRejectedValue(new Error("database unavailable"));
    const response = await GET(new Request("http://localhost/api/transactions/tx-1"), context("tx-1"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load transaction" });
  });
});
