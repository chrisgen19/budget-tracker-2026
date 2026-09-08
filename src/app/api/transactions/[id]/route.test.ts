import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getAuthUserId: vi.fn(),
  categoryFindMany: vi.fn(),
  labelFindMany: vi.fn(),
  transactionLabelDeleteMany: vi.fn(),
  transactionLabelCreateMany: vi.fn(),
  update: vi.fn(),
  findUniqueOrThrow: vi.fn(),
}));

// `categoriesAreUsable` is deliberately left unmocked: it is the shared predicate under test, so
// the PUT cases below exercise the real one against a mocked `category.findMany` rather than a
// stub that would agree with whatever the route did.
vi.mock("@/lib/prisma", () => {
  const client = {
    transaction: {
      findFirst: mocks.findFirst,
      update: mocks.update,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
    },
    category: { findMany: mocks.categoryFindMany },
    label: { findMany: mocks.labelFindMany },
    transactionLabel: {
      deleteMany: mocks.transactionLabelDeleteMany,
      createMany: mocks.transactionLabelCreateMany,
    },
    $transaction: vi.fn((run: (tx: unknown) => unknown) => run(client)),
  };
  return { prisma: client };
});
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

import { GET, PUT } from "@/app/api/transactions/[id]/route";

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

describe("PUT /api/transactions/[id]", () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    amount: 250,
    description: "Groceries",
    type: "EXPENSE",
    date: "2026-09-07",
    categoryId: "cat-1",
    ...overrides,
  });

  const put = (payload: Record<string, unknown>, id = "tx-1") =>
    PUT(
      new Request(`http://localhost/api/transactions/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
      context(id),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.findFirst.mockResolvedValue({ id: "tx-1", userId: "user-1", labels: [] });
    // The caller's own EXPENSE category, so the happy path is the default.
    mocks.categoryFindMany.mockResolvedValue([{ id: "cat-1", type: "EXPENSE" }]);
    mocks.labelFindMany.mockResolvedValue([]);
    mocks.transactionLabelDeleteMany.mockResolvedValue({ count: 0 });
    mocks.transactionLabelCreateMany.mockResolvedValue({ count: 0 });
    mocks.update.mockResolvedValue({ id: "tx-1" });
    mocks.findUniqueOrThrow.mockResolvedValue({ id: "tx-1", categoryId: "cat-1" });
  });

  it("writes when the category is the caller's own and matches the type", async () => {
    const response = await put(body());

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ categoryId: "cat-1" }) }),
    );
  });

  it("accepts a default category, which belongs to nobody", async () => {
    mocks.categoryFindMany.mockResolvedValue([{ id: "cat-default", type: "EXPENSE" }]);

    const response = await put(body({ categoryId: "cat-default" }));

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalled();
  });

  // #229: the foreign key only requires the category row to exist, so another user's category
  // was accepted and then rendered back through the response's `include`.
  it("refuses a category that is neither the caller's nor a default, and writes nothing", async () => {
    mocks.categoryFindMany.mockResolvedValue([]);

    const response = await put(body({ categoryId: "someone-elses-category" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "The category is invalid, does not belong to you, or does not match the transaction type",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  // #229: an EXPENSE filed under an INCOME category is internally inconsistent and distorts
  // every breakdown that groups by category. The picker filters by type, the server did not.
  it("refuses a category whose type disagrees with the transaction, and writes nothing", async () => {
    mocks.categoryFindMany.mockResolvedValue([{ id: "cat-salary", type: "INCOME" }]);

    const response = await put(body({ type: "EXPENSE", categoryId: "cat-salary" }));

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("scopes the category lookup to the caller's own categories and the shared defaults", async () => {
    await put(body());

    expect(mocks.categoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["cat-1"] },
          OR: [{ userId: "user-1" }, { userId: null }],
        }),
      }),
    );
  });

  it("checks the category before the labels, so one bad request names one cause", async () => {
    mocks.categoryFindMany.mockResolvedValue([]);

    const response = await put(body({ categoryId: "nope", labelIds: ["label-1"] }));

    expect(response.status).toBe(400);
    expect(mocks.labelFindMany).not.toHaveBeenCalled();
  });

  it("still refuses labels that are not the caller's", async () => {
    mocks.labelFindMany.mockResolvedValue([]);

    const response = await put(body({ labelIds: ["someone-elses-label"] }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "One or more labels are invalid or do not belong to you",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  // The state this must not punish is reachable with no MCP involvement: `PUT /api/categories/[id]`
  // flips a custom category's type while its transactions keep pointing at it. This route is a full
  // replace, so the browser re-sends the stale pair on every edit -- and rejecting it would lock the
  // row out of being edited at all, down to fixing a typo in its description.
  it("allows an edit that re-sends an already-mismatched pair unchanged", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      categoryId: "cat-flipped",
      type: "EXPENSE",
      labels: [],
    });
    // The stored category's type has since been flipped, so the pair no longer agrees.
    mocks.categoryFindMany.mockResolvedValue([{ id: "cat-flipped", type: "INCOME" }]);

    const response = await put(
      body({ categoryId: "cat-flipped", type: "EXPENSE", description: "typo fixed" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalled();
    // Not merely tolerated -- not asked about, since writing back what is stored moves nothing.
    expect(mocks.categoryFindMany).not.toHaveBeenCalled();
  });

  it("still refuses a move onto a mismatched category from an already-mismatched row", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      categoryId: "cat-flipped",
      type: "EXPENSE",
      labels: [],
    });
    mocks.categoryFindMany.mockResolvedValue([{ id: "cat-salary", type: "INCOME" }]);

    const response = await put(body({ categoryId: "cat-salary", type: "EXPENSE" }));

    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  // #232: the columns existed but only the MCP tool wrote them, so a row corrected over MCP and
  // then fixed in the app went on naming the token as its last editor -- a trail that is not
  // merely missing but wrong.
  it("stamps APP and clears the token id when the edit changes something", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      amount: 250,
      description: "Grocries",
      type: "EXPENSE",
      date: new Date("2026-09-07T02:00:00.000Z"),
      categoryId: "cat-1",
      labels: [],
    });

    const response = await put(
      body({ description: "Groceries", date: "2026-09-07T02:00:00.000Z" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ updatedVia: "APP", updatedByMcpTokenId: null }),
      }),
    );
  });

  // The form posts all five fields on every save, so "the request named it" is true of every
  // field on every edit. Stamping on that would rewrite a genuine MCP trail to APP for pressing
  // Update with nothing changed.
  it("writes nothing at all when the save moves neither a scalar nor a label", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      amount: 250,
      description: "Groceries",
      type: "EXPENSE",
      date: new Date("2026-09-07T02:00:00.000Z"),
      categoryId: "cat-1",
      labels: [],
    });

    const response = await put(body({ date: "2026-09-07T02:00:00.000Z" }));

    expect(response.status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    // The label sync used to delete and recreate the same links on every save regardless.
    expect(mocks.transactionLabelDeleteMany).not.toHaveBeenCalled();
  });

  it("stamps when only the labels move, since no scalar carries that edit", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      amount: 250,
      description: "Groceries",
      type: "EXPENSE",
      date: new Date("2026-09-07T02:00:00.000Z"),
      categoryId: "cat-1",
      labels: [{ labelId: "label-1", label: { applicableTo: "BOTH" } }],
    });
    mocks.labelFindMany.mockResolvedValue([{ id: "label-2", applicableTo: "BOTH" }]);

    const response = await put(
      body({ date: "2026-09-07T02:00:00.000Z", labelIds: ["label-2"] }),
    );

    expect(response.status).toBe(200);
    expect(mocks.transactionLabelDeleteMany).toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ updatedVia: "APP", updatedByMcpTokenId: null }),
      }),
    );
  });

  it("treats a re-sent label set as unmoved, whatever order it arrives in", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "tx-1",
      userId: "user-1",
      amount: 250,
      description: "Groceries",
      type: "EXPENSE",
      date: new Date("2026-09-07T02:00:00.000Z"),
      categoryId: "cat-1",
      labels: [
        { labelId: "label-1", label: { applicableTo: "BOTH" } },
        { labelId: "label-2", label: { applicableTo: "BOTH" } },
      ],
    });
    mocks.labelFindMany.mockResolvedValue([
      { id: "label-2", applicableTo: "BOTH" },
      { id: "label-1", applicableTo: "BOTH" },
    ]);

    const response = await put(
      body({ date: "2026-09-07T02:00:00.000Z", labelIds: ["label-2", "label-1"] }),
    );

    expect(response.status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.transactionLabelDeleteMany).not.toHaveBeenCalled();
  });

  it("404s a transaction that is not the caller's before reading the body", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const response = await put(body());

    expect(response.status).toBe(404);
    expect(mocks.categoryFindMany).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
