import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  tileFindMany: vi.fn(),
  tileCreate: vi.fn(),
  tileUpdate: vi.fn(),
  tileDeleteMany: vi.fn(),
  tileFindFirst: vi.fn(),
  categoryFindMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    category: { findMany: mocks.categoryFindMany },
    telegramQuickTile: {
      findMany: mocks.tileFindMany,
      findFirst: mocks.tileFindFirst,
      create: mocks.tileCreate,
      update: mocks.tileUpdate,
      deleteMany: mocks.tileDeleteMany,
    },
    $transaction: mocks.transaction,
  },
}));

import { GET, POST } from "@/app/api/tg/tiles/route";
import { DELETE, PATCH } from "@/app/api/tg/tiles/[id]/route";
import { POST as REORDER } from "@/app/api/tg/tiles/reorder/route";
import { MAX_QUICK_TILES } from "@/lib/telegram/quick-tiles";

const BOT_TOKEN = "123456:TEST-BOT-TOKEN-NOT-REAL";
const USER_JSON = '{"id":42424242,"first_name":"Chris","username":"Chris_Dev","language_code":"en"}';
const AUTH_DATE_SECONDS = 1757289600;
const VALID_HASH = "75d8d2d3db93a979238d51f3188460176c0b66b797192ca329f7e5ca1df2d5ae";

const INIT_DATA =
  `auth_date=${AUTH_DATE_SECONDS}` +
  `&query_id=AAF_test_query` +
  `&user=${encodeURIComponent(USER_JSON)}` +
  `&hash=${VALID_HASH}`;

const AUTH = `tma ${INIT_DATA}`;

const CATEGORIES = [
  { id: "transportation", name: "Transportation", type: "EXPENSE", icon: "Car", color: "#000", isDefault: true },
  { id: "other", name: "Other Expense", type: "EXPENSE", icon: "Tag", color: "#000", isDefault: true },
  { id: "salary", name: "Salary", type: "INCOME", icon: "Wallet", color: "#000", isDefault: true },
];

const tileRow = (over: Record<string, unknown> = {}) => ({
  id: "tile_1",
  label: "To office",
  description: "fare to office",
  amount: 38,
  type: "EXPENSE",
  categoryId: "transportation",
  sortOrder: 10,
  ...over,
});

const req = (url: string, method: string, body?: unknown, authorization: string | null = AUTH) =>
  new Request(url, {
    method,
    headers: authorization ? { authorization, "content-type": "application/json" } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AUTH_DATE_SECONDS * 1000 + 30_000));

  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_ALLOWED_IDS = "42424242";
  process.env.TELEGRAM_ALLOWED_USERNAMES = "";

  mocks.userFindUnique.mockResolvedValue({ id: "user_1" });
  mocks.categoryFindMany.mockResolvedValue(CATEGORIES);
  mocks.tileFindMany.mockResolvedValue([tileRow()]);
  mocks.tileFindFirst.mockResolvedValue(tileRow());
  mocks.tileCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(tileRow({ id: "tile_new", ...data }))
  );
  mocks.tileUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(tileRow({ ...data }))
  );
  mocks.tileDeleteMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/tg/tiles", () => {
  it("refuses without initData", async () => {
    expect((await GET(req("https://x.test/api/tg/tiles", "GET", undefined, null))).status).toBe(401);
  });

  it("reports where each tile would actually file", async () => {
    // The resolved name travels on every read so a tile whose category was deleted while the app
    // was closed is visibly degraded in the grid, rather than degrading on the next tap.
    mocks.tileFindMany.mockResolvedValue([tileRow({ categoryId: "deleted-id" })]);

    const body = await (await GET(req("https://x.test/api/tg/tiles", "GET"))).json();

    expect(body.tiles[0].categoryId).toBe("deleted-id");
    expect(body.tiles[0].resolvedCategoryName).toBe("Transportation");
    expect(body.tiles[0].fallsBack).toBe(true);
  });
});

describe("POST /api/tg/tiles", () => {
  const newTile = {
    label: "Lunch",
    description: "lunch at work",
    amount: null,
    type: "EXPENSE",
    categoryId: null,
  };

  it("creates a tile and reports its resolved category", async () => {
    mocks.tileFindMany.mockResolvedValue([]);

    const res = await POST(req("https://x.test/api/tg/tiles", "POST", newTile));

    expect(res.status).toBe(201);
    expect(mocks.tileCreate).toHaveBeenCalled();
  });

  it("refuses past the tile cap", async () => {
    mocks.tileFindMany.mockResolvedValue(
      Array.from({ length: MAX_QUICK_TILES }, (_, i) => tileRow({ id: `t${i}`, sortOrder: i * 10 }))
    );

    expect((await POST(req("https://x.test/api/tg/tiles", "POST", newTile))).status).toBe(409);
    expect(mocks.tileCreate).not.toHaveBeenCalled();
  });

  it("refuses a category whose type disagrees with the tile", async () => {
    // `categoriesAreUsable` would reject this later, inside the write -- but only when a tap is
    // logged, which is a confusing place to discover it. The edit is where the user can act.
    const res = await POST(
      req("https://x.test/api/tg/tiles", "POST", { ...newTile, categoryId: "salary" })
    );

    expect(res.status).toBe(400);
    expect(mocks.tileCreate).not.toHaveBeenCalled();
  });

  it("refuses a category the user does not have", async () => {
    const res = await POST(
      req("https://x.test/api/tg/tiles", "POST", { ...newTile, categoryId: "someone_elses" })
    );

    expect(res.status).toBe(400);
  });

  it("appends past the highest existing sortOrder", async () => {
    mocks.tileFindMany.mockResolvedValue([tileRow({ sortOrder: 10 }), tileRow({ sortOrder: 70 })]);

    await POST(req("https://x.test/api/tg/tiles", "POST", newTile));

    expect(mocks.tileCreate.mock.calls.at(-1)![0].data.sortOrder).toBe(80);
  });

  it("rejects a blank label", async () => {
    const res = await POST(req("https://x.test/api/tg/tiles", "POST", { ...newTile, label: "  " }));

    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/tg/tiles/[id]", () => {
  it("404s a tile belonging to someone else", async () => {
    // 404 rather than 403, which would confirm the tile exists.
    mocks.tileFindFirst.mockResolvedValue(null);

    const res = await PATCH(
      req("https://x.test/api/tg/tiles/x", "PATCH", { label: "Mine now" }),
      params("x")
    );

    expect(res.status).toBe(404);
    expect(mocks.tileUpdate).not.toHaveBeenCalled();
  });

  it("clears a fixed amount when sent an explicit null", async () => {
    // `null` is a real value meaning "make this button ask". Treated as absent, that edit would be
    // impossible to express, which is why the schema is nullable rather than optional.
    await PATCH(req("https://x.test/api/tg/tiles/tile_1", "PATCH", { amount: null }), params("tile_1"));

    expect(mocks.tileUpdate.mock.calls.at(-1)![0].data).toEqual({ amount: null });
  });

  it("writes only the keys actually sent", async () => {
    await PATCH(req("https://x.test/api/tg/tiles/tile_1", "PATCH", { label: "Office" }), params("tile_1"));

    expect(mocks.tileUpdate.mock.calls.at(-1)![0].data).toEqual({ label: "Office" });
  });

  it("checks the effective row, catching a bare type flip", async () => {
    // The patch names no category, so nothing about `categoryId` looks wrong on its own -- and the
    // tile would be left an income button filed under a transport category. Same rule
    // `updateTransactions` and `updateBill` both apply.
    mocks.tileFindFirst.mockResolvedValue(tileRow({ categoryId: "transportation" }));

    const res = await PATCH(
      req("https://x.test/api/tg/tiles/tile_1", "PATCH", { type: "INCOME" }),
      params("tile_1")
    );

    expect(res.status).toBe(400);
    expect(mocks.tileUpdate).not.toHaveBeenCalled();
  });

  it("allows a type flip that moves the category with it", async () => {
    const res = await PATCH(
      req("https://x.test/api/tg/tiles/tile_1", "PATCH", { type: "INCOME", categoryId: "salary" }),
      params("tile_1")
    );

    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/tg/tiles/[id]", () => {
  it("scopes the delete by user in one statement", async () => {
    await DELETE(req("https://x.test/api/tg/tiles/tile_1", "DELETE"), params("tile_1"));

    // No separate ownership read, so there is no window between the check and the delete.
    expect(mocks.tileDeleteMany).toHaveBeenCalledWith({
      where: { id: "tile_1", userId: "user_1" },
    });
  });

  it("404s when nothing was deleted", async () => {
    mocks.tileDeleteMany.mockResolvedValue({ count: 0 });

    const res = await DELETE(req("https://x.test/api/tg/tiles/x", "DELETE"), params("x"));

    expect(res.status).toBe(404);
  });
});

describe("POST /api/tg/tiles/reorder", () => {
  beforeEach(() => {
    mocks.tileFindMany.mockResolvedValue([
      tileRow({ id: "a", sortOrder: 10 }),
      tileRow({ id: "b", sortOrder: 20 }),
    ]);
  });

  it("rewrites sortOrder in one transaction", async () => {
    await REORDER(req("https://x.test/api/tg/tiles/reorder", "POST", { ids: ["b", "a"] }));

    // One transaction, so a failure partway leaves the previous order intact rather than a grid
    // half in each arrangement.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tileUpdate.mock.calls.map((c) => [c[0].where.id, c[0].data.sortOrder])).toEqual([
      ["b", 10],
      ["a", 20],
    ]);
  });

  it("refuses a foreign id spliced into the list", async () => {
    const res = await REORDER(
      req("https://x.test/api/tg/tiles/reorder", "POST", { ids: ["a", "someone_elses"] })
    );

    expect(res.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses a partial list", async () => {
    // An omitted id keeps its old `sortOrder` and lands somewhere the user did not put it, so a
    // partial reorder leaves a grid nobody arranged.
    const res = await REORDER(req("https://x.test/api/tg/tiles/reorder", "POST", { ids: ["a"] }));

    expect(res.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses duplicate ids", async () => {
    const res = await REORDER(
      req("https://x.test/api/tg/tiles/reorder", "POST", { ids: ["a", "a"] })
    );

    expect(res.status).toBe(400);
  });
});
