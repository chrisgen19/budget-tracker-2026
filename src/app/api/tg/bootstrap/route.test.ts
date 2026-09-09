import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  tileFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
  labelFindMany: vi.fn(),
  transactionFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    category: { findMany: mocks.categoryFindMany },
    label: { findMany: mocks.labelFindMany },
    telegramQuickTile: { findMany: mocks.tileFindMany },
    transaction: { findMany: mocks.transactionFindMany },
  },
}));

import { GET } from "@/app/api/tg/bootstrap/route";

const BOT_TOKEN = "123456:TEST-BOT-TOKEN-NOT-REAL";
const USER_JSON = '{"id":42424242,"first_name":"Chris","username":"Chris_Dev","language_code":"en"}';
const AUTH_DATE_SECONDS = 1757289600;
const VALID_HASH = "75d8d2d3db93a979238d51f3188460176c0b66b797192ca329f7e5ca1df2d5ae";

const INIT_DATA =
  `auth_date=${AUTH_DATE_SECONDS}` +
  `&query_id=AAF_test_query` +
  `&user=${encodeURIComponent(USER_JSON)}` +
  `&hash=${VALID_HASH}`;

const get = (authorization: string | null = `tma ${INIT_DATA}`) =>
  GET(
    new Request("https://example.test/api/tg/bootstrap", {
      headers: authorization ? { authorization } : {},
    })
  );

const txRow = (description: string, day: number) => ({
  description,
  amount: 250,
  date: new Date(Date.UTC(2026, 8, day, 4, 0, 0)),
  categoryId: "transportation",
  category: { name: "Transportation" },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AUTH_DATE_SECONDS * 1000 + 30_000));

  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_ALLOWED_IDS = "42424242";
  process.env.TELEGRAM_ALLOWED_USERNAMES = "";

  mocks.userFindUnique.mockResolvedValue({ id: "user_1", currency: "PHP", timezoneOffset: -480 });
  mocks.categoryFindMany.mockResolvedValue([
    { id: "transportation", name: "Transportation", type: "EXPENSE", icon: "Car", color: "#000", isDefault: true },
  ]);
  mocks.tileFindMany.mockResolvedValue([
    {
      id: "tile_1",
      label: "To office",
      description: "fare to office",
      amount: 38,
      type: "EXPENSE",
      categoryId: "transportation",
      sortOrder: 10,
      labels: [],
    },
  ]);
  mocks.labelFindMany.mockResolvedValue([]);
  mocks.transactionFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/tg/bootstrap", () => {
  it("refuses without initData, and reads no data", async () => {
    const res = await get(null);

    expect(res.status).toBe(401);
    expect(mocks.tileFindMany).not.toHaveBeenCalled();
    expect(mocks.transactionFindMany).not.toHaveBeenCalled();
  });

  it("returns everything the grid needs in one response", async () => {
    // One round trip rather than four, because a webview cold start is the slow moment.
    const body = await (await get()).json();

    expect(body.user).toEqual({ currency: "PHP", timezoneOffset: -480 });
    expect(body.tiles).toHaveLength(1);
    expect(body.tiles[0].resolvedCategoryName).toBe("Transportation");
    expect(body.categories).toHaveLength(1);
    expect(body.limits.maxTiles).toBeGreaterThan(0);
  });

  it("does not offer a Frequent tile for something already configured", async () => {
    // The grid would otherwise show the same thing twice, and the derived copy carries no
    // configured category.
    mocks.transactionFindMany.mockResolvedValue([
      txRow("fare to office", 1),
      txRow("Fare To Office", 2),
      txRow("fare to office", 3),
    ]);

    const body = await (await get()).json();

    expect(body.frequent).toHaveLength(0);
  });

  it("offers a Frequent tile for something that is not configured", async () => {
    mocks.transactionFindMany.mockResolvedValue([txRow("grab", 1), txRow("grab", 2), txRow("grab", 3)]);

    const body = await (await get()).json();

    expect(body.frequent).toHaveLength(1);
    expect(body.frequent[0].description).toBe("grab");
  });

  it("derives the window from the account's own timezone", async () => {
    // Never `TELEGRAM_TZ_OFFSET`, which describes the bot's prompt clock and would be a second
    // source of truth for the same fact.
    process.env.TELEGRAM_TZ_OFFSET = "0";
    mocks.userFindUnique.mockResolvedValue({ id: "user_1", currency: "PHP", timezoneOffset: -480 });

    await get();

    const { where } = mocks.transactionFindMany.mock.calls.at(-1)![0];
    // 23:59:59.999 of the user's local day, which is 15:59:59.999Z at UTC+8.
    expect(where.date.lte.toISOString().endsWith("15:59:59.999Z")).toBe(true);
  });

  it("401s when the account vanished between the gate and the read", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({ id: "user_1" }).mockResolvedValueOnce(null);

    expect((await get()).status).toBe(401);
  });
});
