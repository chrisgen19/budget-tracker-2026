// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rules a quick-log button obeys, exercised through the shared module rather than through
 * either route, because both routes are now mappings from these results to status codes.
 *
 * The label half is what is new, and each test here is written to fail against the code before
 * pins existed: a promised-but-unwritten label is the whole failure mode this feature could
 * introduce, and `createTransactionBatch` type-filters explicit ids **silently**.
 */

const mocks = vi.hoisted(() => ({
  createTransactionBatch: vi.fn(),
  findSavedBatch: vi.fn(),
  categoryFindMany: vi.fn(),
  labelFindMany: vi.fn(),
  tileFindMany: vi.fn(),
  tileFindFirst: vi.fn(),
  tileFindFirstOrThrow: vi.fn(),
  tileCreate: vi.fn(),
  tileUpdateMany: vi.fn(),
  tileLabelDeleteMany: vi.fn(),
  tileLabelCreateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/transaction-writes", () => ({
  createTransactionBatch: mocks.createTransactionBatch,
  findSavedBatch: mocks.findSavedBatch,
}));

import {
  createQuickTile,
  listQuickTiles,
  logQuickTile,
  updateQuickTile,
} from "@/lib/quick-tile-writes";
import type { PrismaClient } from "@/lib/budget-query-types";

const CATEGORIES = [
  { id: "transportation", name: "Transportation", type: "EXPENSE", icon: "Car", color: "#000", isDefault: true },
  { id: "other", name: "Other Expense", type: "EXPENSE", icon: "Tag", color: "#000", isDefault: true },
  { id: "salary", name: "Salary", type: "INCOME", icon: "Wallet", color: "#000", isDefault: true },
];

const LABELS = [
  { id: "l_work", name: "Work", color: "#111111", applicableTo: "BOTH" },
  { id: "l_commute", name: "Commute", color: "#222222", applicableTo: "EXPENSE" },
  { id: "l_payday", name: "Payday", color: "#333333", applicableTo: "INCOME" },
];

const tileRow = (over: Record<string, unknown> = {}) => ({
  id: "tile_1",
  label: "To office",
  description: "fare to office",
  amount: 38,
  type: "EXPENSE",
  categoryId: "transportation",
  sortOrder: 10,
  labels: [] as { labelId: string }[],
  ...over,
});

/** The tile shape `logQuickTile` reads: pins arrive joined to their labels. */
const logTileRow = (over: Record<string, unknown> = {}) => ({
  description: "fare to office",
  amount: 38,
  type: "EXPENSE",
  categoryId: "transportation",
  labels: [] as { label: { id: string; applicableTo: string } }[],
  ...over,
});

const prisma = {
  category: { findMany: mocks.categoryFindMany },
  label: { findMany: mocks.labelFindMany },
  telegramQuickTile: {
    findMany: mocks.tileFindMany,
    findFirst: mocks.tileFindFirst,
    findFirstOrThrow: mocks.tileFindFirstOrThrow,
    create: mocks.tileCreate,
    updateMany: mocks.tileUpdateMany,
  },
  telegramQuickTileLabel: {
    deleteMany: mocks.tileLabelDeleteMany,
    createMany: mocks.tileLabelCreateMany,
  },
  $transaction: mocks.transaction,
} as unknown as PrismaClient;

const input = (over: Record<string, unknown> = {}) => ({
  label: "To office",
  description: "fare to office",
  amount: 38,
  type: "EXPENSE" as const,
  categoryId: "transportation",
  ...over,
});

/** The item `createTransactionBatch` was actually asked to write. */
const writtenItem = () => mocks.createTransactionBatch.mock.calls.at(-1)![0].items[0];

beforeEach(() => {
  mocks.categoryFindMany.mockResolvedValue(CATEGORIES);
  mocks.labelFindMany.mockResolvedValue(LABELS);
  mocks.tileFindMany.mockResolvedValue([]);
  mocks.tileFindFirst.mockResolvedValue(tileRow());
  mocks.tileFindFirstOrThrow.mockResolvedValue(tileRow());
  mocks.tileCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
    const { labels, ...scalars } = data as { labels?: { create?: { labelId: string }[] } };
    return Promise.resolve(tileRow({ id: "tile_new", ...scalars, labels: labels?.create ?? [] }));
  });
  mocks.tileUpdateMany.mockResolvedValue({ count: 1 });
  mocks.tileLabelDeleteMany.mockResolvedValue({ count: 0 });
  mocks.tileLabelCreateMany.mockResolvedValue({ count: 0 });
  mocks.transaction.mockResolvedValue([]);
  mocks.findSavedBatch.mockResolvedValue([]);
  mocks.createTransactionBatch.mockResolvedValue({
    ok: true,
    replayed: false,
    transactions: [
      {
        id: "tx_1",
        amount: 38,
        description: "fare to office",
        category: { name: "Transportation" },
        labels: [],
      },
    ],
  });
});

describe("pinning labels to a button", () => {
  it("refuses a label whose type disagrees with the button's", async () => {
    // `createTransactionBatch` drops a type-incompatible id silently, so accepting this would show
    // "Payday" in the editor and never write it. A refusal at the edit is the only place the user
    // can act on it.
    const result = await createQuickTile(prisma, "user_1", input({ labelIds: ["l_payday"] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("LABELS_UNUSABLE");
    expect(result.message).toContain("Payday");
    expect(mocks.tileCreate).not.toHaveBeenCalled();
  });

  it("refuses a label that is not the caller's", async () => {
    const result = await createQuickTile(prisma, "user_1", input({ labelIds: ["l_someone_else"] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("LABELS_UNUSABLE");
    expect(mocks.tileCreate).not.toHaveBeenCalled();
  });

  it("accepts a BOTH label and one matching the button's type", async () => {
    const result = await createQuickTile(
      prisma,
      "user_1",
      input({ labelIds: ["l_work", "l_commute"] })
    );

    expect(result.ok).toBe(true);
    expect(mocks.tileCreate.mock.calls.at(-1)![0].data.labels).toEqual({
      create: [{ labelId: "l_work" }, { labelId: "l_commute" }],
    });
  });

  it("re-judges the pins it is keeping when a patch flips the type", async () => {
    // The patch names neither `labelIds` nor `categoryId`, so nothing in the request looks wrong.
    // Judged against the *effective* row, the kept Commute pin is an expense-only label on an
    // income button -- which would be dropped in silence at the next tap.
    mocks.tileFindFirst.mockResolvedValue(
      tileRow({ categoryId: null, labels: [{ labelId: "l_commute" }] })
    );

    const result = await updateQuickTile(prisma, "user_1", "tile_1", { type: "INCOME" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("LABELS_UNUSABLE");
    expect(result.message).toContain("Commute");
    expect(mocks.tileUpdateMany).not.toHaveBeenCalled();
  });

  it("lets an editor with no label picker rename a button carrying a pin that no longer applies", async () => {
    // The Mini App's editor sends no `labelIds` and has no picker, so re-judging the kept pins on
    // every patch made this button uneditable from inside Telegram with no way to fix it there.
    // Reachable with no edit at all: `PUT /api/labels/[id]` narrows a label's type underneath the
    // buttons that pin it. Judging only what moves is the rule `updateBill` already follows.
    mocks.labelFindMany.mockResolvedValue([
      { id: "l_stale", name: "Payday", color: "#333333", applicableTo: "INCOME" },
    ]);
    mocks.tileFindFirst.mockResolvedValue(tileRow({ labels: [{ labelId: "l_stale" }] }));
    mocks.tileFindFirstOrThrow.mockResolvedValue(tileRow({ labels: [{ labelId: "l_stale" }] }));

    const result = await updateQuickTile(prisma, "user_1", "tile_1", { label: "Renamed" });

    expect(result.ok).toBe(true);
    // And the pin is left in place rather than quietly dropped: the grid reports it as not
    // applying and the tap filters it out, so nothing is lost and nothing is written wrongly.
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("leaves the pins alone when the patch does not name them", async () => {
    mocks.tileFindFirst.mockResolvedValue(tileRow({ labels: [{ labelId: "l_work" }] }));
    mocks.tileFindFirstOrThrow.mockResolvedValue(tileRow({ labels: [{ labelId: "l_work" }] }));

    const result = await updateQuickTile(prisma, "user_1", "tile_1", { label: "Office" });

    expect(result.ok).toBe(true);
    // Restating an unchanged set must not rewrite the link rows: a delete-then-create that changes
    // nothing is a write with no change behind it, the same thing the app's edit paths refuse.
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("replaces the pins when the patch moves them", async () => {
    mocks.tileFindFirst.mockResolvedValue(tileRow({ labels: [{ labelId: "l_work" }] }));

    const result = await updateQuickTile(prisma, "user_1", "tile_1", {
      labelIds: ["l_commute"],
    });

    expect(result.ok).toBe(true);
    expect(mocks.tileLabelDeleteMany).toHaveBeenCalledWith({ where: { tileId: "tile_1" } });
    expect(mocks.tileLabelCreateMany).toHaveBeenCalledWith({
      data: [{ tileId: "tile_1", labelId: "l_commute" }],
    });
  });

  it("clears the pins on an explicit empty list", async () => {
    mocks.tileFindFirst.mockResolvedValue(tileRow({ labels: [{ labelId: "l_work" }] }));

    const result = await updateQuickTile(prisma, "user_1", "tile_1", { labelIds: [] });

    expect(result.ok).toBe(true);
    expect(mocks.tileLabelCreateMany).toHaveBeenCalledWith({ data: [] });
  });
});

describe("what a tap writes", () => {
  it("omits labelIds entirely when the button has no pins", async () => {
    // The distinction is load-bearing and invisible in the response: `undefined` lets auto-apply
    // schedules run, `[]` is an explicit opt-out from them. Every button behaved this way before
    // pins existed and an unpinned one still must.
    mocks.tileFindFirst.mockResolvedValue(logTileRow());

    await logQuickTile(
      prisma,
      "user_1",
      { tileId: "tile_1", description: "x", amount: 1, type: "EXPENSE", clientBatchId: KEY },
      "APP"
    );

    expect(writtenItem()).not.toHaveProperty("labelIds");
  });

  it("sends the pinned ids when the button has them, so schedules do not run", async () => {
    mocks.tileFindFirst.mockResolvedValue(
      logTileRow({
        labels: [
          { label: { id: "l_work", applicableTo: "BOTH" } },
          { label: { id: "l_commute", applicableTo: "EXPENSE" } },
        ],
      })
    );

    await logQuickTile(
      prisma,
      "user_1",
      { tileId: "tile_1", description: "x", amount: 1, type: "EXPENSE", clientBatchId: KEY },
      "APP"
    );

    expect(writtenItem().labelIds).toEqual(["l_work", "l_commute"]);
  });

  it("drops a pin whose label was narrowed after it was saved, and keeps the rest", async () => {
    // `PUT /api/labels/[id]` can narrow `applicable_to` underneath a button that was valid when it
    // was pinned. Filtered here rather than downstream, where it would vanish with no sign it was
    // ever promised -- and the remaining pin must still suppress schedules.
    mocks.tileFindFirst.mockResolvedValue(
      logTileRow({
        labels: [
          { label: { id: "l_work", applicableTo: "BOTH" } },
          { label: { id: "l_payday", applicableTo: "INCOME" } },
        ],
      })
    );

    await logQuickTile(
      prisma,
      "user_1",
      { tileId: "tile_1", description: "x", amount: 1, type: "EXPENSE", clientBatchId: KEY },
      "APP"
    );

    expect(writtenItem().labelIds).toEqual(["l_work"]);
  });

  it("omits labelIds when every pin was narrowed away, rather than sending an empty opt-out", async () => {
    mocks.tileFindFirst.mockResolvedValue(
      logTileRow({ labels: [{ label: { id: "l_payday", applicableTo: "INCOME" } }] })
    );

    await logQuickTile(
      prisma,
      "user_1",
      { tileId: "tile_1", description: "x", amount: 1, type: "EXPENSE", clientBatchId: KEY },
      "APP"
    );

    expect(writtenItem()).not.toHaveProperty("labelIds");
  });

  it("names the surface that was tapped rather than the code path", async () => {
    mocks.tileFindFirst.mockResolvedValue(logTileRow());

    await logQuickTile(
      prisma,
      "user_1",
      { tileId: "tile_1", description: "x", amount: 1, type: "EXPENSE", clientBatchId: KEY },
      "TELEGRAM"
    );

    expect(mocks.createTransactionBatch.mock.calls.at(-1)![0].createdVia).toBe("TELEGRAM");
    expect(mocks.createTransactionBatch.mock.calls.at(-1)![0]).not.toHaveProperty("mcpTokenId");
  });

  it("ignores a client-supplied amount for a button carrying its own", async () => {
    mocks.tileFindFirst.mockResolvedValue(logTileRow({ amount: 38 }));

    await logQuickTile(
      prisma,
      "user_1",
      { tileId: "tile_1", description: "x", amount: 9999, type: "EXPENSE", clientBatchId: KEY },
      "APP"
    );

    expect(writtenItem().amount).toBe(38);
  });
});

describe("reading the grid", () => {
  it("reports a pin that no longer applies rather than hiding it", async () => {
    // The button still carries the pin, so the grid says so and marks it as not applying. Hiding
    // it would make a configured label indistinguishable from one that was never set.
    mocks.tileFindMany.mockResolvedValue([
      tileRow({ labels: [{ labelId: "l_work" }, { labelId: "l_payday" }] }),
    ]);

    const { tiles } = await listQuickTiles(prisma, "user_1");

    expect(tiles[0].labels).toEqual([
      { id: "l_work", name: "Work", color: "#111111", applies: true },
      { id: "l_payday", name: "Payday", color: "#333333", applies: false },
    ]);
  });
});

const KEY = "0f1e2d3c-4b5a-4968-8776-655443332211";
