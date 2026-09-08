import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_BULK_TRANSACTIONS } from "@/lib/transaction-bulk";
import { MAX_BREAKDOWN_LINE_ITEMS } from "@/lib/receipt-limits";

const mocks = vi.hoisted(() => {
  const transactionFindMany = vi.fn();
  const transactionUpdateMany = vi.fn();
  const transactionDeleteMany = vi.fn();
  const categoryFindFirst = vi.fn();
  const labelFindMany = vi.fn();
  const transactionLabelFindMany = vi.fn();
  const transactionLabelCreateMany = vi.fn();
  const transactionLabelDeleteMany = vi.fn();
  return {
    transactionFindMany,
    transactionUpdateMany,
    transactionDeleteMany,
    categoryFindFirst,
    labelFindMany,
    transactionLabelFindMany,
    transactionLabelCreateMany,
    transactionLabelDeleteMany,
    getAuthUserId: vi.fn(),
    databaseTransaction: vi.fn(),
    createTransactionBatch: vi.fn(),
    findSavedBatch: vi.fn(),
    findSavedBatchUnderLock: vi.fn(),
    tx: {
      transaction: {
        findMany: transactionFindMany,
        updateMany: transactionUpdateMany,
        deleteMany: transactionDeleteMany,
      },
      category: { findFirst: categoryFindFirst },
      label: { findMany: labelFindMany },
      transactionLabel: {
        findMany: transactionLabelFindMany,
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
  createTransactionBatch: mocks.createTransactionBatch,
  findSavedBatch: mocks.findSavedBatch,
  findSavedBatchUnderLock: mocks.findSavedBatchUnderLock,
}));

import { DELETE, PATCH, POST } from "@/app/api/transactions/batch/route";

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

const postRequest = (body: unknown) =>
  new NextRequest("http://localhost/api/transactions/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * A request that declares its size up front, the honest-client case the header check exists for.
 *
 * Set by hand because `new Request(url, { body: string })` does *not* populate `content-length`
 * in undici — a plain `postRequest` therefore exercises the metered read, not the header, and
 * naming that here is the difference between two tests and one test written twice.
 */
const declaredRequest = (body: unknown) => {
  const payload = JSON.stringify(body);
  return new NextRequest("http://localhost/api/transactions/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "content-length": String(new TextEncoder().encode(payload).byteLength),
    },
    body: payload,
  });
};

/** The same body with no `content-length` at all, which a header check cannot see. */
const chunkedRequest = (body: unknown, method = "POST") =>
  new NextRequest("http://localhost/api/transactions/batch", {
    method,
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(JSON.stringify(body));
        for (let at = 0; at < bytes.byteLength; at += 64 * 1024) {
          controller.enqueue(bytes.slice(at, at + 64 * 1024));
        }
        controller.close();
      },
    }),
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1] & { duplex: "half" });

const BATCH_ID = "3f1c2b7a-2f5e-4d0a-9b1e-0c8a6d4e5f21";

const row = (overrides: Record<string, unknown> = {}) => ({
  amount: 12.5,
  description: "Groceries",
  type: "EXPENSE",
  date: "2026-09-08",
  categoryId: "cat-1",
  ...overrides,
});

/** A row carrying the blob #137 tripled the ceiling on: 150 items x a 255-char name, ~43 KB. */
const fatRow = () =>
  row({
    receiptBreakdown: {
      total: 1000,
      items: Array.from({ length: MAX_BREAKDOWN_LINE_ITEMS }, () => ({
        name: "x".repeat(255),
        amount: 1,
      })),
    },
  });

/**
 * Far past what `boundedTransactionIdsSchema` allows, which is the point for DELETE and PATCH:
 * the size guard is reached first, so an oversized body is refused rather than materialised in
 * order to be rejected.
 */
const floodOfIds = () => Array.from({ length: 60_000 }, () => "x".repeat(100));

describe("POST /api/transactions/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.findSavedBatch.mockResolvedValue([]);
    mocks.createTransactionBatch.mockResolvedValue({
      ok: true,
      replayed: false,
      transactions: [{ id: "tx-1" }],
    });
  });

  it("saves a batch that stays under the body ceiling", async () => {
    const response = await POST(postRequest({ transactions: [row()], clientBatchId: BATCH_ID }));
    expect(response.status).toBe(201);
    expect(mocks.createTransactionBatch).toHaveBeenCalledOnce();
  });

  it("refuses a declared oversize without reading the body or looking it up", async () => {
    // 200 rows x 150 items x a 255-char name is schema-legal and lands near 8.6 MB.
    const request = declaredRequest({
      transactions: Array.from({ length: 200 }, fatRow),
      clientBatchId: BATCH_ID,
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "BODY_TOO_LARGE" });
    // Never buffered: the whole point of checking the header first.
    expect(request.bodyUsed).toBe(false);
    // And nothing was written, nor was the idempotency lookup reached.
    expect(mocks.findSavedBatch).not.toHaveBeenCalled();
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });

  it("refuses an oversized body that declares no content-length", async () => {
    // The half a header check cannot do. Without the metered read this is a 201.
    const response = await POST(
      chunkedRequest({ transactions: Array.from({ length: 200 }, fatRow) }),
    );

    expect(response.status).toBe(413);
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });

  it("still replays a committed batch whose body is within the ceiling", async () => {
    mocks.findSavedBatch.mockResolvedValue([{ id: "tx-1" }]);

    const response = await POST(postRequest({ transactions: [row()], clientBatchId: BATCH_ID }));

    expect(response.status).toBe(200);
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/transactions/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.databaseTransaction.mockImplementation((callback) => callback(mocks.tx));
    mocks.transactionFindMany.mockResolvedValue([{ id: "tx-1" }]);
    mocks.transactionDeleteMany.mockResolvedValue({ count: 1 });
  });

  it("refuses an oversized body before opening a database transaction", async () => {
    const response = await DELETE(chunkedRequest({ ids: floodOfIds() }, "DELETE"));
    expect(response.status).toBe(413);
    expect(mocks.databaseTransaction).not.toHaveBeenCalled();
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
      { id: "tx-1", type: "EXPENSE", categoryId: "cat-old" },
      { id: "tx-2", type: "EXPENSE", categoryId: "cat-old" },
    ]);
    mocks.transactionUpdateMany.mockResolvedValue({ count: 2 });
    mocks.categoryFindFirst.mockResolvedValue({ id: "cat-1", type: "EXPENSE" });
    mocks.labelFindMany.mockResolvedValue([{ id: "label-1", applicableTo: "BOTH" }]);
    mocks.transactionLabelFindMany.mockResolvedValue([]);
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

  it("reports only transactions that receive a new label link", async () => {
    mocks.transactionLabelFindMany.mockResolvedValue([
      { transactionId: "tx-1", labelId: "label-1" },
    ]);
    mocks.transactionLabelCreateMany.mockResolvedValue({ count: 1 });

    const response = await PATCH(
      patchRequest({
        action: "labels",
        operation: "add",
        ids: ["tx-1", "tx-2"],
        labelIds: ["label-1"],
      }),
    );

    expect(await response.json()).toMatchObject({
      matched: 2,
      updated: 1,
      changedLinks: 1,
      ids: ["tx-2"],
    });
    expect(mocks.transactionLabelCreateMany).toHaveBeenCalledWith({
      data: [{ transactionId: "tx-2", labelId: "label-1" }],
      skipDuplicates: true,
    });
  });

  it("reports only transactions from which a label link is removed", async () => {
    mocks.transactionLabelFindMany.mockResolvedValue([
      { transactionId: "tx-2", labelId: "label-1" },
    ]);
    mocks.transactionLabelDeleteMany.mockResolvedValue({ count: 1 });

    const response = await PATCH(
      patchRequest({
        action: "labels",
        operation: "remove",
        ids: ["tx-1", "tx-2"],
        labelIds: ["label-1"],
      }),
    );

    expect(await response.json()).toMatchObject({
      matched: 2,
      updated: 1,
      changedLinks: 1,
      ids: ["tx-2"],
    });
  });

  // #232: a bulk change is an edit, and leaving these columns alone left a row corrected over MCP
  // naming the token as its last editor long after the app had changed it.
  it("stamps APP and clears the token id on a bulk recategorise", async () => {
    await PATCH(patchRequest({ action: "category", ids: ["tx-1", "tx-2"], categoryId: "cat-1" }));

    expect(mocks.transactionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { categoryId: "cat-1", updatedVia: "APP", updatedByMcpTokenId: null },
      }),
    );
  });

  // The other half of the rule: stamping the rows that did not move would replace an accurate MCP
  // trail with a fabricated APP one for an edit that never happened.
  it("skips rows already in the target category rather than recording an edit on them", async () => {
    mocks.transactionFindMany.mockResolvedValue([
      { id: "tx-1", type: "EXPENSE", categoryId: "cat-old" },
      { id: "tx-2", type: "EXPENSE", categoryId: "cat-1" },
    ]);
    mocks.transactionUpdateMany.mockResolvedValue({ count: 1 });

    const response = await PATCH(
      patchRequest({ action: "category", ids: ["tx-1", "tx-2"], categoryId: "cat-1" }),
    );

    // `matched` still names the whole selection; `updated` names only what moved.
    expect(await response.json()).toMatchObject({ matched: 2, updated: 1 });
    expect(mocks.transactionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["tx-1"] } }) }),
    );
  });

  // The label branches touch no column on `transactions`, so the stamp cannot ride along on an
  // existing update the way the category branch's does -- it needs its own.
  it("stamps only the rows that actually gained a label link", async () => {
    mocks.transactionLabelFindMany.mockResolvedValue([
      { transactionId: "tx-1", labelId: "label-1" },
    ]);
    mocks.transactionLabelCreateMany.mockResolvedValue({ count: 1 });

    await PATCH(
      patchRequest({
        action: "labels",
        operation: "add",
        ids: ["tx-1", "tx-2"],
        labelIds: ["label-1"],
      }),
    );

    expect(mocks.transactionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["tx-2"] }, userId: "user-1" },
      data: { updatedVia: "APP", updatedByMcpTokenId: null },
    });
  });

  it("stamps only the rows that actually lost a label link", async () => {
    mocks.transactionLabelFindMany.mockResolvedValue([
      { transactionId: "tx-2", labelId: "label-1" },
    ]);
    mocks.transactionLabelDeleteMany.mockResolvedValue({ count: 1 });

    await PATCH(
      patchRequest({
        action: "labels",
        operation: "remove",
        ids: ["tx-1", "tx-2"],
        labelIds: ["label-1"],
      }),
    );

    expect(mocks.transactionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["tx-2"] }, userId: "user-1" },
      data: { updatedVia: "APP", updatedByMcpTokenId: null },
    });
  });

  it("writes no stamp when a label operation changes nothing", async () => {
    mocks.transactionLabelFindMany.mockResolvedValue([]);

    await PATCH(
      patchRequest({
        action: "labels",
        operation: "remove",
        ids: ["tx-1", "tx-2"],
        labelIds: ["label-1"],
      }),
    );

    expect(mocks.transactionUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses an oversized body before opening a database transaction", async () => {
    const response = await PATCH(
      chunkedRequest({ action: "category", ids: floodOfIds(), categoryId: "cat-1" }, "PATCH"),
    );
    expect(response.status).toBe(413);
    expect(mocks.databaseTransaction).not.toHaveBeenCalled();
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
