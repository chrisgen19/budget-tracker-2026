import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  categoryFindMany: vi.fn(),
  queryRaw: vi.fn(),
  photoFindMany: vi.fn(),
  create: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  order: [] as string[],
}));

vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));
vi.mock("@/lib/schedule-server", () => ({
  getScheduleContext: vi.fn(async () => null),
  matchScheduledLabel: vi.fn(() => null),
}));
vi.mock("@/lib/credit-card-access", () => ({ userCanUseCreditCards: vi.fn(async () => true) }));
vi.mock("@/lib/prisma", () => {
  const client = {
    category: { findMany: mocks.categoryFindMany },
    label: { findMany: vi.fn(async () => []) },
    receiptPhoto: { findMany: mocks.photoFindMany },
    transaction: { create: mocks.create, findUniqueOrThrow: mocks.findUniqueOrThrow },
    transactionLabel: { createMany: vi.fn() },
    // The locking category re-check inside the write transaction.
    $queryRaw: mocks.queryRaw,
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => {
      mocks.order.push("tx");
      return run(client);
    }),
  };
  return { prisma: client };
});

import { POST } from "@/app/api/transactions/route";

const post = (payload: Record<string, unknown>) =>
  POST(new Request("http://localhost/api/transactions", { method: "POST", body: JSON.stringify(payload) }));

const body = (overrides: Record<string, unknown> = {}) => ({
  amount: 250,
  description: "Groceries",
  type: "EXPENSE",
  date: "2026-09-07T02:00:00.000Z",
  categoryId: "cat-1",
  ...overrides,
});

describe("POST /api/transactions receipt photos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.categoryFindMany.mockResolvedValue([{ id: "cat-1", type: "EXPENSE" }]);
    mocks.queryRaw.mockResolvedValue([{ id: "cat-1", type: "EXPENSE" }]);
    mocks.photoFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
      mocks.order.push("photos");
      return where.id.in.filter((id) => id === "p-own").map((id) => ({ id }));
    });
    mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      mocks.order.push("create");
      return { id: "tx-1", ...data };
    });
    mocks.findUniqueOrThrow.mockResolvedValue({ id: "tx-1" });
  });

  it("refuses another user's photo with 400 and creates nothing", async () => {
    const response = await post(body({ receiptPhotoId: "p-foreign" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Photo not found" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.photoFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["p-foreign"] }, userId: "user-1" },
      select: { id: true },
    });
  });

  it("links the caller's own photo, checking it inside the write transaction", async () => {
    const response = await post(body({ receiptPhotoId: "p-own" }));

    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ receiptPhotoId: "p-own" }),
    });
    expect(mocks.order).toEqual(["tx", "photos", "create"]);
  });

  it("asks nothing about photos when none is sent", async () => {
    const response = await post(body());

    expect(response.status).toBe(201);
    expect(mocks.photoFindMany).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0][0].data).not.toHaveProperty("receiptPhotoId");
  });
});
