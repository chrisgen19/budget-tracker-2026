import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  categoryFindFirst: vi.fn(),
  categoryUpdate: vi.fn(),
  transactionCount: vi.fn(),
  billCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findFirst: mocks.categoryFindFirst, update: mocks.categoryUpdate },
    transaction: { count: mocks.transactionCount },
    scheduledTransaction: { count: mocks.billCount },
  },
}));
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

import { PUT } from "@/app/api/categories/[id]/route";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

const body = (overrides: Record<string, unknown> = {}) => ({
  name: "Freelance",
  type: "EXPENSE",
  icon: "MoreHorizontal",
  color: "#E07C4F",
  ...overrides,
});

const put = (payload: Record<string, unknown>, id = "cat-1") =>
  PUT(
    new Request(`http://localhost/api/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
    context(id),
  );

describe("PUT /api/categories/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.categoryFindFirst.mockResolvedValue({
      id: "cat-1",
      userId: "user-1",
      type: "EXPENSE",
      isDefault: false,
    });
    mocks.transactionCount.mockResolvedValue(0);
    mocks.billCount.mockResolvedValue(0);
    mocks.categoryUpdate.mockResolvedValue({ id: "cat-1" });
  });

  it("saves an edit that leaves the type alone, however many rows use it", async () => {
    mocks.transactionCount.mockResolvedValue(12);

    const response = await put(body({ name: "Renamed" }));

    expect(response.status).toBe(200);
    expect(mocks.categoryUpdate).toHaveBeenCalled();
    // Not even counted: the rows are unaffected by a rename or a recolour.
    expect(mocks.transactionCount).not.toHaveBeenCalled();
  });

  it("flips the type freely while nothing points at the category", async () => {
    const response = await put(body({ type: "INCOME" }));

    expect(response.status).toBe(200);
    expect(mocks.categoryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "INCOME" }) }),
    );
  });

  // Without this the flip succeeded silently, leaving every one of those transactions with a
  // type its category no longer agrees with -- the state PUT /api/transactions/[id] then has to
  // tolerate on every later edit (#229).
  it("refuses a type flip while transactions use the category, and writes nothing", async () => {
    mocks.transactionCount.mockResolvedValue(12);

    const response = await put(body({ type: "INCOME" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "Cannot change type: 12 transaction(s) use this category. Move them to another category first.",
      transactionCount: 12,
      billCount: 0,
    });
    expect(mocks.categoryUpdate).not.toHaveBeenCalled();
  });

  // A bill left pointing at a mismatched category writes a wrong-typed transaction every time it
  // is paid, so counting only transactions would let the flip through on an unused-but-scheduled
  // category and reintroduce the inconsistency on the next payment.
  it("refuses a type flip while only a bill uses the category", async () => {
    mocks.billCount.mockResolvedValue(1);

    const response = await put(body({ type: "INCOME" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error:
        "Cannot change type: 1 bill(s) use this category. Move them to another category first.",
      transactionCount: 0,
      billCount: 1,
    });
    expect(mocks.categoryUpdate).not.toHaveBeenCalled();
  });

  it("names both when transactions and bills each use the category", async () => {
    mocks.transactionCount.mockResolvedValue(12);
    mocks.billCount.mockResolvedValue(1);

    const response = await put(body({ type: "INCOME" }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(
      "Cannot change type: 12 transaction(s) and 1 bill(s) use this category. Move them to another category first.",
    );
  });

  it("404s a category that is not the caller's, or is a default", async () => {
    mocks.categoryFindFirst.mockResolvedValue(null);

    const response = await put(body({ type: "INCOME" }));

    expect(response.status).toBe(404);
    expect(mocks.transactionCount).not.toHaveBeenCalled();
    expect(mocks.categoryUpdate).not.toHaveBeenCalled();
  });
});
