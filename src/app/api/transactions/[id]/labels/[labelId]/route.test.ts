import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  transactionFindFirst: vi.fn(),
  transactionUpdateMany: vi.fn(),
  transactionLabelDeleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: {
      findFirst: mocks.transactionFindFirst,
      updateMany: mocks.transactionUpdateMany,
    },
    transactionLabel: { deleteMany: mocks.transactionLabelDeleteMany },
  },
}));
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

import { DELETE } from "@/app/api/transactions/[id]/labels/[labelId]/route";

const context = (id: string, labelId: string) => ({
  params: Promise.resolve({ id, labelId }),
});

const del = (id = "tx-1", labelId = "label-1") =>
  DELETE(
    new Request(`http://localhost/api/transactions/${id}/labels/${labelId}`, {
      method: "DELETE",
    }),
    context(id, labelId),
  );

describe("DELETE /api/transactions/[id]/labels/[labelId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.transactionFindFirst.mockResolvedValue({ id: "tx-1" });
    mocks.transactionLabelDeleteMany.mockResolvedValue({ count: 1 });
    mocks.transactionUpdateMany.mockResolvedValue({ count: 1 });
  });

  // #232: removing a label is an edit of the transaction, so it has to name the app as the row's
  // last editor. Left alone, a row corrected over MCP and then un-labelled here went on naming
  // the token -- a trail that is wrong rather than merely missing.
  it("stamps APP and clears the token id once a link is really removed", async () => {
    const response = await del();

    expect(response.status).toBe(200);
    expect(mocks.transactionUpdateMany).toHaveBeenCalledWith({
      where: { id: "tx-1", userId: "user-1" },
      data: { updatedVia: "APP", updatedByMcpTokenId: null },
    });
  });

  it("stamps nothing when the label was not on the transaction", async () => {
    mocks.transactionLabelDeleteMany.mockResolvedValue({ count: 0 });

    const response = await del();

    expect(response.status).toBe(404);
    expect(mocks.transactionUpdateMany).not.toHaveBeenCalled();
  });

  it("stamps nothing on a transaction that is not the caller's", async () => {
    mocks.transactionFindFirst.mockResolvedValue(null);

    const response = await del();

    expect(response.status).toBe(404);
    expect(mocks.transactionLabelDeleteMany).not.toHaveBeenCalled();
    expect(mocks.transactionUpdateMany).not.toHaveBeenCalled();
  });
});
