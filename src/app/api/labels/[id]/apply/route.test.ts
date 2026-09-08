import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  labelFindFirst: vi.fn(),
  transactionFindMany: vi.fn(),
  transactionUpdateMany: vi.fn(),
  transactionLabelCreateMany: vi.fn(),
  transactionLabelDeleteMany: vi.fn(),
  getScheduleContext: vi.fn(),
  matchScheduledLabel: vi.fn(),
  databaseTransaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const client = {
    label: { findFirst: mocks.labelFindFirst },
    transaction: {
      findMany: mocks.transactionFindMany,
      updateMany: mocks.transactionUpdateMany,
    },
    transactionLabel: {
      createMany: mocks.transactionLabelCreateMany,
      deleteMany: mocks.transactionLabelDeleteMany,
    },
    $transaction: mocks.databaseTransaction,
  };
  // A spy rather than a plain passthrough, so a test can assert the batch's writes were issued
  // inside a transaction at all -- reverting to independent awaits never calls this.
  mocks.databaseTransaction.mockImplementation((run: (tx: unknown) => unknown) => run(client));
  return { prisma: client };
});
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));
vi.mock("@/lib/schedule-server", () => ({
  getScheduleContext: mocks.getScheduleContext,
  matchScheduledLabel: mocks.matchScheduledLabel,
}));

import { POST } from "@/app/api/labels/[id]/apply/route";

const apply = (id = "label-1") =>
  POST(new Request(`http://localhost/api/labels/${id}/apply`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

const row = (id: string, labels: { id: string }[] = []) => ({
  id,
  date: new Date("2026-09-07T02:00:00.000Z"),
  type: "EXPENSE" as const,
  labels,
});

describe("POST /api/labels/[id]/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.labelFindFirst.mockResolvedValue({
      id: "label-1",
      applicableTo: "BOTH",
      schedules: [{ id: "sched-1" }],
    });
    mocks.getScheduleContext.mockResolvedValue({ labels: [], timezoneOffset: -480 });
    mocks.transactionLabelCreateMany.mockResolvedValue({ count: 1 });
    mocks.transactionLabelDeleteMany.mockResolvedValue({ count: 1 });
    mocks.transactionUpdateMany.mockResolvedValue({ count: 1 });
  });

  // #232: a retroactive apply is a user-initiated edit of these transactions' labels. Without the
  // stamp, a row corrected over MCP and then retro-labelled here went on naming the token as its
  // last editor.
  it("stamps APP and clears the token id on rows that gain the label", async () => {
    mocks.transactionFindMany.mockResolvedValueOnce([row("tx-1"), row("tx-2")]);
    // tx-1 matches the schedule and has no link yet; tx-2 matches nothing and has none either.
    mocks.matchScheduledLabel.mockImplementation((_date, _ctx, _type) => null);
    mocks.matchScheduledLabel.mockReturnValueOnce("label-1");

    const response = await apply();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: 1 });
    expect(mocks.transactionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["tx-1"] }, userId: "user-1" },
      data: { updatedVia: "APP", updatedByMcpTokenId: null },
    });
  });

  it("stamps rows that lose a stale association too", async () => {
    mocks.transactionFindMany.mockResolvedValueOnce([row("tx-1", [{ id: "link-1" }])]);
    // The window no longer matches, so the existing link is removed.
    mocks.matchScheduledLabel.mockReturnValue(null);

    const response = await apply();

    expect(await response.json()).toMatchObject({ removed: 1 });
    expect(mocks.transactionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["tx-1"] }, userId: "user-1" },
      data: { updatedVia: "APP", updatedByMcpTokenId: null },
    });
  });

  // A pass that leaves every row exactly as it found it is not an edit of anything.
  it("stamps nothing when no association changes", async () => {
    mocks.transactionFindMany.mockResolvedValueOnce([row("tx-1", [{ id: "link-1" }])]);
    // Already labelled and still matching: nothing to insert, nothing to remove.
    mocks.matchScheduledLabel.mockReturnValue("label-1");

    const response = await apply();

    expect(await response.json()).toMatchObject({ applied: 0, removed: 0 });
    expect(mocks.transactionUpdateMany).not.toHaveBeenCalled();
  });

  // A rerun sees the associations already in their desired state, so `touchedIds` comes back
  // empty and the stamp is never reattempted. A stamp lost to a failed write is therefore lost
  // for good, which is why the batch has to be all-or-nothing -- review #5136117235 / #5136133314.
  it("issues a batch's association write and its stamp inside one database transaction", async () => {
    mocks.transactionFindMany.mockResolvedValueOnce([row("tx-1")]);
    mocks.matchScheduledLabel.mockReturnValue("label-1");

    await apply();

    expect(mocks.databaseTransaction).toHaveBeenCalledTimes(1);
    const opened = mocks.databaseTransaction.mock.invocationCallOrder[0];
    expect(mocks.transactionLabelCreateMany.mock.invocationCallOrder[0]).toBeGreaterThan(opened);
    expect(mocks.transactionUpdateMany.mock.invocationCallOrder[0]).toBeGreaterThan(opened);
  });

  // A pass over a settled label walks every page finding nothing to do; a transaction per page
  // would be a round trip bought for no reason.
  it("opens no transaction for a batch with nothing to write", async () => {
    mocks.transactionFindMany.mockResolvedValueOnce([row("tx-1", [{ id: "link-1" }])]);
    mocks.matchScheduledLabel.mockReturnValue("label-1");

    await apply();

    expect(mocks.databaseTransaction).not.toHaveBeenCalled();
  });

  it("404s a label that is not the caller's, before touching any transaction", async () => {
    mocks.labelFindFirst.mockResolvedValue(null);

    const response = await apply();

    expect(response.status).toBe(404);
    expect(mocks.transactionFindMany).not.toHaveBeenCalled();
    expect(mocks.transactionUpdateMany).not.toHaveBeenCalled();
  });
});
