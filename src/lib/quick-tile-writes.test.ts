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
  tileUpdate: vi.fn(),
  tileUpdateMany: vi.fn(),
  tileLabelFindMany: vi.fn(),
  tileLabelDeleteMany: vi.fn(),
  tileLabelCreateMany: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
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
// `categories` is the relation `listOwnedLabels` selects. Empty means every category.
  { id: "l_work", name: "Work", color: "#111111", applicableTo: "BOTH", categories: [] },
  { id: "l_commute", name: "Commute", color: "#222222", applicableTo: "EXPENSE", categories: [] },
  { id: "l_payday", name: "Payday", color: "#333333", applicableTo: "INCOME", categories: [] },
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
  labels: [] as { label: { id: string; applicableTo: string; categories?: { categoryId: string }[] } }[],
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
    update: mocks.tileUpdate,
    updateMany: mocks.tileUpdateMany,
  },
  telegramQuickTileLabel: {
    findMany: mocks.tileLabelFindMany,
    deleteMany: mocks.tileLabelDeleteMany,
    createMany: mocks.tileLabelCreateMany,
  },
  $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
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
  mocks.tileUpdate.mockImplementation(() => Promise.resolve(tileRow()));
  // Faithful to Prisma, which emits **no statement at all** for an empty `data` and reports
  // `count: 0`. A mock that answered 1 here would hide the bug this models: an edit that moves
  // only `labelIds` has no scalar fields, so a staleness check reading that count refused it.
  mocks.tileUpdateMany.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ count: Object.keys(data).length === 0 ? 0 : 1 })
  );
  mocks.tileLabelFindMany.mockImplementation(async () => {
    const row = await mocks.tileFindFirst();
    return row?.labels ?? [];
  });
  mocks.tileLabelDeleteMany.mockResolvedValue({ count: 0 });
  mocks.tileLabelCreateMany.mockResolvedValue({ count: 0 });
  // `updateQuickTile` runs the interactive form and hands the callback a transaction client;
  // `reorderQuickTiles` still uses the array form. The mock has to serve both.
  mocks.transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.resolve([])
  );
  // The `SELECT ... FOR UPDATE` that opens the edit. Derived from whatever `findFirst` is
  // returning, so a test that changes the stored row does not have to restate it here.
  mocks.executeRaw.mockResolvedValue(1);
  mocks.queryRaw.mockImplementation(async () => {
    const row = await mocks.tileFindFirst();
    return row ? [{ type: row.type, category_id: row.categoryId }] : [];
  });
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

  // Its own message, not folded into the type one: the two are fixed on different screens, and
  // "cannot be used on an expense button" would send the user to the wrong one.
  it("refuses a label limited to categories the button does not file into", async () => {
    mocks.labelFindMany.mockResolvedValue([
      ...LABELS,
      {
        id: "l_shopee",
        name: "Shopee",
        color: "#444444",
        applicableTo: "EXPENSE",
        categories: [{ categoryId: "other" }],
      },
    ]);

    const result = await createQuickTile(prisma, "user_1", input({ labelIds: ["l_shopee"] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("LABELS_UNUSABLE");
    expect(result.message).toContain("Shopee");
    expect(result.message).toContain("category");
    expect(mocks.tileCreate).not.toHaveBeenCalled();
  });

  // A tile with no category of its own still files somewhere: `resolveTileCategory` reads the
  // description, and the form shows the user that answer while they pin. Judging the pin against
  // the raw null instead let every restricted label through, so a Shopping-only label could be
  // pinned to a fare that resolves to Transportation -- saved, then marked stale, then silently
  // dropped on every tap.
  const shopeeOnly = {
    id: "l_shopee",
    name: "Shopee",
    color: "#444444",
    applicableTo: "EXPENSE",
    categories: [{ categoryId: "other" }],
  };

  it("refuses a pin the resolved category excludes, with no category chosen", async () => {
    mocks.labelFindMany.mockResolvedValue([...LABELS, shopeeOnly]);

    // "fare to office" resolves to Transportation, which Shopee does not cover.
    const result = await createQuickTile(
      prisma,
      "user_1",
      input({ categoryId: null, labelIds: ["l_shopee"] })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("LABELS_UNUSABLE");
    expect(mocks.tileCreate).not.toHaveBeenCalled();
  });

  it("accepts a pin the resolved category allows, with no category chosen", async () => {
    mocks.labelFindMany.mockResolvedValue([...LABELS, shopeeOnly]);

    // Nothing in "misc stuff" matches a hint, so it falls back to Other -- which Shopee covers.
    const result = await createQuickTile(
      prisma,
      "user_1",
      input({ categoryId: null, description: "misc stuff", labelIds: ["l_shopee"] })
    );

    expect(result.ok).toBe(true);
  });

  it("reads the cap and the sort order under a per-user advisory lock", async () => {
    // A bare count-then-insert cannot enforce a limit under READ COMMITTED. Measured against a
    // real database: four concurrent creates against eleven existing tiles all read eleven, all
    // passed a cap of twelve, and left fifteen -- three sharing one sortOrder, since the index on
    // (userId, sortOrder) is not unique.
    await createQuickTile(prisma, "user_1", input());

    expect(mocks.transaction).toHaveBeenCalled();
    const [sql, key] = mocks.executeRaw.mock.calls.at(-1)!;
    expect(String(sql.join(""))).toContain("pg_advisory_xact_lock");
    // Namespaced, so creating a button does not queue behind a scan-credit reservation for the
    // same user: `scan-quota.ts` locks on the bare id and the two bound different resources.
    expect(key).toBe("quick-tile:user_1");
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
    expect(mocks.tileUpdate).not.toHaveBeenCalled();
  });

  it("lets an editor with no label picker rename a button carrying a pin that no longer applies", async () => {
    // The Mini App's editor sends no `labelIds` and has no picker, so re-judging the kept pins on
    // every patch made this button uneditable from inside Telegram with no way to fix it there.
    // Reachable with no edit at all: `PUT /api/labels/[id]` narrows a label's type underneath the
    // buttons that pin it. Judging only what moves is the rule `updateBill` already follows.
    mocks.labelFindMany.mockResolvedValue([
      { id: "l_stale", name: "Payday", color: "#333333", applicableTo: "INCOME", categories: [] },
    ]);
    mocks.tileFindFirst.mockResolvedValue(tileRow({ labels: [{ labelId: "l_stale" }] }));
    mocks.tileFindFirstOrThrow.mockResolvedValue(tileRow({ labels: [{ labelId: "l_stale" }] }));

    // The Mini App's real payload: its editor submits the complete draft, so `type` and
    // `categoryId` are always present and always equal to what is stored. Gating on their
    // *presence* rather than their movement therefore fired on every edit it made, which is how
    // the previous version of this fix failed for the one client it was written for.
    const result = await updateQuickTile(prisma, "user_1", "tile_1", {
      label: "Renamed",
      description: "fare to office",
      amount: 38,
      type: "EXPENSE",
      categoryId: "transportation",
    });

    expect(result.ok).toBe(true);
    // And the pin is left in place rather than quietly dropped: the grid reports it as not
    // applying and the tap filters it out, so nothing is lost and nothing is written wrongly.
    expect(mocks.tileLabelDeleteMany).not.toHaveBeenCalled();
    expect(mocks.tileLabelCreateMany).not.toHaveBeenCalled();
  });

  it("leaves the pins alone when the patch does not name them", async () => {
    mocks.tileFindFirst.mockResolvedValue(tileRow({ labels: [{ labelId: "l_work" }] }));
    mocks.tileFindFirstOrThrow.mockResolvedValue(tileRow({ labels: [{ labelId: "l_work" }] }));

    const result = await updateQuickTile(prisma, "user_1", "tile_1", { label: "Office" });

    expect(result.ok).toBe(true);
    // Restating an unchanged set must not rewrite the link rows: a delete-then-create that changes
    // nothing is a write with no change behind it, the same thing the app's edit paths refuse.
    expect(mocks.tileLabelDeleteMany).not.toHaveBeenCalled();
    expect(mocks.tileLabelCreateMany).not.toHaveBeenCalled();
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

  it("lets that editor rename a button whose category type was flipped underneath it", async () => {
    // The same dead end one check earlier, and reachable the same way with no edit at all:
    // `PUT /api/categories/[id]` lets a custom category's type be flipped under its buttons.
    // `resolveTileCategory` is built to tolerate that state, so refusing the edit strands it.
    mocks.categoryFindMany.mockResolvedValue([
      { id: "transportation", name: "Transportation", type: "INCOME", icon: "Car", color: "#000", isDefault: true },
      { id: "other", name: "Other Expense", type: "EXPENSE", icon: "Tag", color: "#000", isDefault: true },
    ]);

    const result = await updateQuickTile(prisma, "user_1", "tile_1", {
      label: "Renamed",
      description: "fare to office",
      amount: 38,
      type: "EXPENSE",
      categoryId: "transportation",
    });

    expect(result.ok).toBe(true);
  });

  it("still refuses a category the patch actually moves to", async () => {
    const result = await updateQuickTile(prisma, "user_1", "tile_1", { categoryId: "salary" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("CATEGORY_UNUSABLE");
  });

  it("refuses when the pins moved under the edit, not only the type or category", async () => {
    // The pins are part of what the checks judged, so they are part of what the locked read
    // re-checks. Without this: one edit swaps a BOTH pin for an EXPENSE-only one while another,
    // validated against the original pin, flips the tile to INCOME -- and the flip landed,
    // leaving a pin that cannot apply on the button it cannot apply to.
    // No category, so the flip is not refused earlier for an unrelated reason.
    mocks.tileFindFirst.mockResolvedValue(
      tileRow({ categoryId: null, labels: [{ labelId: "l_work" }] })
    );
    // What another edit committed in the gap: the BOTH pin swapped for an EXPENSE-only one.
    mocks.tileLabelFindMany.mockResolvedValue([{ labelId: "l_commute" }]);

    const result = await updateQuickTile(prisma, "user_1", "tile_1", { type: "INCOME" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("STALE");
    expect(mocks.tileUpdate).not.toHaveBeenCalled();
  });

  it("saves a patch that changes only the labels", async () => {
    // An edit that moves only `labelIds` has no scalar fields to write, and Prisma emits no
    // statement at all for an empty `data` -- it reports `count: 0`, which the staleness branch
    // read as "the row moved underneath you". Changing only a button's labels answered a spurious
    // 409 and wrote nothing. Staleness is now judged by the locking SELECT, which always runs.
    mocks.tileFindFirst.mockResolvedValue(tileRow({ labels: [] }));

    const result = await updateQuickTile(prisma, "user_1", "tile_1", { labelIds: ["l_work"] });

    expect(result.ok).toBe(true);
    expect(mocks.tileLabelCreateMany).toHaveBeenCalledWith({
      data: [{ tileId: "tile_1", labelId: "l_work" }],
    });
  });

  it("refuses when the row moved under the edit", async () => {
    // The locked row disagrees with the one the checks were run against.
    mocks.queryRaw.mockResolvedValue([{ type: "INCOME", category_id: null }]);

    const result = await updateQuickTile(prisma, "user_1", "tile_1", { label: "Renamed" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("STALE");
    expect(mocks.tileLabelCreateMany).not.toHaveBeenCalled();
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
          { label: { id: "l_work", applicableTo: "BOTH", categories: [] } },
          { label: { id: "l_commute", applicableTo: "EXPENSE", categories: [] } },
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
          { label: { id: "l_work", applicableTo: "BOTH", categories: [] } },
          { label: { id: "l_payday", applicableTo: "INCOME", categories: [] } },
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
      logTileRow({
        labels: [{ label: { id: "l_payday", applicableTo: "INCOME", categories: [] } }],
      })
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

describe("a pin the tap's category excludes", () => {
  // Filtered at the write, not refused: nobody named this label at the moment of the tap. It was
  // pinned when the button was made and the restriction may have been narrowed since, and a
  // button that stops working because of an edit elsewhere is the wrong failure.
  it("is dropped, and the rest are kept", async () => {
    mocks.tileFindFirst.mockResolvedValue(
      logTileRow({
        labels: [
          { label: { id: "l_work", applicableTo: "BOTH", categories: [] } },
          {
            label: {
              id: "l_shopee",
              applicableTo: "EXPENSE",
              categories: [{ categoryId: "other" }],
            },
          },
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
