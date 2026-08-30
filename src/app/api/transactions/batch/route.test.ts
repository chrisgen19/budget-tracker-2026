import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_BULK_TRANSACTIONS } from "@/lib/transaction-bulk";

const mocks = vi.hoisted(() => {
  const transactionFindMany = vi.fn();
  const transactionUpdateMany = vi.fn();
  const transactionDeleteMany = vi.fn();
  const categoryFindFirst = vi.fn();
  const labelFindMany = vi.fn();
  const transactionLabelCreateMany = vi.fn();
  const transactionLabelDeleteMany = vi.fn();
  return {
    transactionFindMany,
    transactionUpdateMany,
    transactionDeleteMany,
    categoryFindFirst,
    labelFindMany,
    transactionLabelCreateMany,
    transactionLabelDeleteMany,
    getAuthUserId: vi.fn(),
    databaseTransaction: vi.fn(),
    tx: {
      transaction: {
        findMany: transactionFindMany,
        updateMany: transactionUpdateMany,
        deleteMany: transactionDeleteMany,
      },
      category: { findFirst: categoryFindFirst },
      label: { findMany: labelFindMany },
      transactionLabel: {
        createMany: transactionLabelCreateMany,
        deleteMany: transactionLabelDeleteMany,
      },
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.databaseTransaction },
}));
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));
vi.mock("@/lib/transaction-writes", () => ({
  createTransactionBatch: vi.fn(),
  findSavedBatch: vi.fn(),
  findSavedBatchUnderLock: vi.fn(),
}));

import { DELETE, PATCH } from "@/app/api/transactions/batch/route";

const patchRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/transactions/batch", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const deleteRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/transactions/batch", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("DELETE /api/transactions/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.databaseTransaction.mockImplementation((callback) => callback(mocks.tx));
    mocks.transactionFindMany.mockResolvedValue([{ id: "tx-1" }]);
    mocks.transactionDeleteMany.mockResolvedValue({ count: 1 });
  });

  it("deletes only the authenticated user's owned subset and returns exact IDs", async () => {
    const response = await DELETE(deleteRequest({ ids: ["tx-1", "tx-1", "stale"] }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1, ids: ["tx-1"] });
    expect(mocks.transactionFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["tx-1", "stale"] }, userId: "user-1" },
      select: { id: true },
    });
    expect(mocks.transactionDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["tx-1"] }, userId: "user-1" },
    });
  });
});

describe("PATCH /api/transactions/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.databaseTransaction.mockImplementation((callback) => callback(mocks.tx));
    mocks.transactionFindMany.mockResolvedValue([
      { id: "tx-1", type: "EXPENSE" },
      { id: "tx-2", type: "EXPENSE" },
    ]);
    mocks.transactionUpdateMany.mockResolvedValue({ count: 2 });
    mocks.categoryFindFirst.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    mocks.labelFindMany.mockResolvedValue([{ id: "label-1", applicableTo: "BOTH" }]);
    mocks.transactionLabelCreateMany.mockResolvedValue({ count: 2 });
    mocks.transactionLabelDeleteMany.mockResolvedValue({ count: 2 });
  });

  it("changes category atomically and scopes both reads and writes by user", async () => {
    const response = await PATCH(
      patchRequest({ action: "category", ids: ["tx-1", "tx-2"], categoryId: "cat-1" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ matched: 2, updated: 2 });
    expect(mocks.transactionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) }),
    );
    expect(mocks.transactionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) }),
    );
  });

  it("rejects a category incompatible with any selected transaction", async () => {
    mocks.transactionFindMany.mockResolvedValue([
      { id: "tx-1", type: "EXPENSE" },
      { id: "tx-2", type: "INCOME" },
    ]);
    const response = await PATCH(
      patchRequest({ action: "category", ids: ["tx-1", "tx-2"], categoryId: "cat-1" }),
    );
    expect(response.status).toBe(409);
    expect(mocks.transactionUpdateMany).not.toHaveBeenCalled();
  });

  it("enforces label applicability when adding labels", async () => {
    mocks.labelFindMany.mockResolvedValue([{ id: "label-1", applicableTo: "INCOME" }]);
    const response = await PATCH(
      patchRequest({
        action: "labels",
        operation: "add",
        ids: ["tx-1"],
        labelIds: ["label-1"],
      }),
    );
    expect(response.status).toBe(409);
    expect(mocks.transactionLabelCreateMany).not.toHaveBeenCalled();
  });

  it("deduplicates IDs and returns authoritative matched counts", async () => {
    const response = await PATCH(
      patchRequest({
        action: "labels",
        operation: "remove",
        ids: ["tx-1", "tx-1"],
        labelIds: ["label-1", "label-1"],
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.transactionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["tx-1"] } }) }),
    );
  });

  it("rejects unbounded ID arrays before opening a database transaction", async () => {
    const response = await PATCH(
      patchRequest({
        action: "category",
        ids: Array.from({ length: MAX_BULK_TRANSACTIONS + 1 }, (_, index) => `tx-${index}`),
        categoryId: "cat-1",
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.databaseTransaction).not.toHaveBeenCalled();
  });
});
