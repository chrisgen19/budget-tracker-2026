// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * The web app's quick-log routes.
 *
 * Deliberately thin over `src/lib/quick-tile-writes.ts`, which is where the rules are tested. What
 * is checked here is the part that is genuinely this layer's: that the session gate runs before
 * anything else, that a refusal reaches the right status code, and that the replay branch on a tap
 * is judged **before** the tile is resolved.
 */

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  categoryFindMany: vi.fn(),
  labelFindMany: vi.fn(),
  tileFindMany: vi.fn(),
  tileFindFirst: vi.fn(),
  tileFindFirstOrThrow: vi.fn(),
  tileCreate: vi.fn(),
  tileUpdateMany: vi.fn(),
  tileDeleteMany: vi.fn(),
  tileUpdate: vi.fn(),
  tileLabelDeleteMany: vi.fn(),
  tileLabelCreateMany: vi.fn(),
  transaction: vi.fn(),
  createTransactionBatch: vi.fn(),
  findSavedBatch: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findMany: mocks.categoryFindMany },
    label: { findMany: mocks.labelFindMany },
    telegramQuickTile: {
      findMany: mocks.tileFindMany,
      findFirst: mocks.tileFindFirst,
      findFirstOrThrow: mocks.tileFindFirstOrThrow,
      create: mocks.tileCreate,
      update: mocks.tileUpdate,
      updateMany: mocks.tileUpdateMany,
      deleteMany: mocks.tileDeleteMany,
    },
    telegramQuickTileLabel: {
      deleteMany: mocks.tileLabelDeleteMany,
      createMany: mocks.tileLabelCreateMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/transaction-writes", () => ({
  createTransactionBatch: mocks.createTransactionBatch,
  findSavedBatch: mocks.findSavedBatch,
}));

import { GET, POST } from "@/app/api/quick-tiles/route";
import { DELETE, PATCH } from "@/app/api/quick-tiles/[id]/route";
import { POST as REORDER } from "@/app/api/quick-tiles/reorder/route";
import { POST as LOG } from "@/app/api/quick-tiles/log/route";
import { MAX_QUICK_TILES } from "@/lib/telegram/quick-tiles";

const KEY = "0f1e2d3c-4b5a-4968-8776-655443332211";

const CATEGORIES = [
  { id: "transportation", name: "Transportation", type: "EXPENSE", icon: "Car", color: "#000", isDefault: true },
  { id: "other", name: "Other Expense", type: "EXPENSE", icon: "Tag", color: "#000", isDefault: true },
];

const LABELS = [
  { id: "l_work", name: "Work", color: "#111111", applicableTo: "BOTH" },
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

const req = (url: string, method: string, body?: unknown) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const newTile = {
  label: "Lunch",
  description: "lunch",
  amount: 150,
  type: "EXPENSE",
  categoryId: "transportation",
};

beforeEach(() => {
  mocks.getAuthUserId.mockResolvedValue("user_1");
  mocks.categoryFindMany.mockResolvedValue(CATEGORIES);
  mocks.labelFindMany.mockResolvedValue(LABELS);
  mocks.tileFindMany.mockResolvedValue([tileRow()]);
  mocks.tileFindFirst.mockResolvedValue(tileRow());
  mocks.tileFindFirstOrThrow.mockResolvedValue(tileRow());
  mocks.tileCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
    const { labels, ...scalars } = data as { labels?: { create?: { labelId: string }[] } };
    return Promise.resolve(tileRow({ id: "tile_new", ...scalars, labels: labels?.create ?? [] }));
  });
  mocks.tileUpdateMany.mockResolvedValue({ count: 1 });
  mocks.tileDeleteMany.mockResolvedValue({ count: 1 });
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

describe("the session gate", () => {
  it("refuses every verb without a session, before touching the database", async () => {
    mocks.getAuthUserId.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    expect((await GET()).status).toBe(401);
    expect(
      (await POST(req("https://x.test/api/quick-tiles", "POST", newTile))).status
    ).toBe(401);
    expect(
      (await PATCH(req("https://x.test/api/quick-tiles/tile_1", "PATCH", {}), params("tile_1")))
        .status
    ).toBe(401);
    expect(
      (await DELETE(req("https://x.test/api/quick-tiles/tile_1", "DELETE"), params("tile_1")))
        .status
    ).toBe(401);
    expect(
      (await LOG(req("https://x.test/api/quick-tiles/log", "POST", { clientBatchId: KEY })))
        .status
    ).toBe(401);

    expect(mocks.tileFindMany).not.toHaveBeenCalled();
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });
});

describe("GET /api/quick-tiles", () => {
  it("returns the grid with the cap the editor needs", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      tiles: [{ id: "tile_1", resolvedCategoryName: "Transportation", labels: [] }],
      limits: { maxTiles: MAX_QUICK_TILES },
    });
  });
});

describe("POST /api/quick-tiles", () => {
  it("creates a button", async () => {
    const res = await POST(req("https://x.test/api/quick-tiles", "POST", newTile));

    expect(res.status).toBe(201);
    expect(mocks.tileCreate).toHaveBeenCalled();
  });

  it("maps a full grid to 409", async () => {
    mocks.tileFindMany.mockResolvedValue(
      Array.from({ length: MAX_QUICK_TILES }, (_, i) => tileRow({ id: `t_${i}` }))
    );

    const res = await POST(req("https://x.test/api/quick-tiles", "POST", newTile));

    expect(res.status).toBe(409);
    expect(mocks.tileCreate).not.toHaveBeenCalled();
  });

  it("maps a label that cannot apply to 400 and names it", async () => {
    const res = await POST(
      req("https://x.test/api/quick-tiles", "POST", { ...newTile, labelIds: ["l_payday"] })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Payday");
    expect(mocks.tileCreate).not.toHaveBeenCalled();
  });
});

describe("PATCH and DELETE /api/quick-tiles/[id]", () => {
  it("answers 404 rather than 403 for a tile that is not the caller's", async () => {
    mocks.tileFindFirst.mockResolvedValue(null);
    mocks.tileDeleteMany.mockResolvedValue({ count: 0 });

    expect(
      (
        await PATCH(
          req("https://x.test/api/quick-tiles/other", "PATCH", { label: "x" }),
          params("other")
        )
      ).status
    ).toBe(404);
    expect(
      (await DELETE(req("https://x.test/api/quick-tiles/other", "DELETE"), params("other"))).status
    ).toBe(404);
  });

  it("maps a row that moved under the edit to 409", async () => {
    mocks.tileUpdateMany.mockResolvedValue({ count: 0 });

    const res = await PATCH(
      req("https://x.test/api/quick-tiles/tile_1", "PATCH", { label: "Renamed" }),
      params("tile_1")
    );

    expect(res.status).toBe(409);
  });
});

describe("POST /api/quick-tiles/reorder", () => {
  it("refuses anything but exactly the caller's current id set", async () => {
    mocks.tileFindMany.mockResolvedValue([tileRow({ id: "a" }), tileRow({ id: "b" })]);

    const res = await REORDER(
      req("https://x.test/api/quick-tiles/reorder", "POST", { ids: ["a"] })
    );

    expect(res.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("POST /api/quick-tiles/log", () => {
  it("logs a tap and stamps it as written from the app", async () => {
    const res = await LOG(
      req("https://x.test/api/quick-tiles/log", "POST", {
        tileId: "tile_1",
        description: "fare to office",
        amount: 38,
        clientBatchId: KEY,
      })
    );

    expect(res.status).toBe(201);
    expect(mocks.createTransactionBatch.mock.calls.at(-1)![0].createdVia).toBe("APP");
    expect(mocks.createTransactionBatch.mock.calls.at(-1)![0]).not.toHaveProperty("mcpTokenId");
  });

  it("answers a replay before resolving the tile, so a deleted button cannot 404 a saved batch", async () => {
    // The client reads a 4xx as proof nothing was written and drops its idempotency pin, so a
    // resubmit under a fresh key would duplicate a committed row. The replay branch therefore runs
    // ahead of every reference the request names -- and ahead of schema validation, so a later
    // tightening cannot reject a replay of a batch accepted under the previous shape.
    mocks.findSavedBatch.mockResolvedValue([
      {
        id: "tx_original",
        amount: 38,
        description: "fare to office",
        category: { name: "Transportation" },
        labels: [],
      },
    ]);
    mocks.tileFindFirst.mockResolvedValue(null);

    const res = await LOG(
      req("https://x.test/api/quick-tiles/log", "POST", {
        tileId: "deleted_tile",
        description: "fare to office",
        amount: 38,
        clientBatchId: KEY,
      })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "tx_original", replayed: true, categoryVia: null });
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });

  it("answers 500 when whether the write landed is unknown", async () => {
    // A 4xx here would tell the client nothing was written, and its retry under a fresh key would
    // write a second row.
    mocks.createTransactionBatch.mockResolvedValue({
      ok: false,
      reason: "UNKNOWN_WHETHER_SAVED",
    });

    const res = await LOG(
      req("https://x.test/api/quick-tiles/log", "POST", {
        tileId: "tile_1",
        description: "fare to office",
        amount: 38,
        clientBatchId: KEY,
      })
    );

    expect(res.status).toBe(500);
  });
});
