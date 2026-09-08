import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  tileFindFirst: vi.fn(),
  categoryFindMany: vi.fn(),
  createTransactionBatch: vi.fn(),
  findSavedBatch: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    telegramQuickTile: { findFirst: mocks.tileFindFirst },
    category: { findMany: mocks.categoryFindMany },
  },
}));

vi.mock("@/lib/transaction-writes", () => ({
  createTransactionBatch: mocks.createTransactionBatch,
  findSavedBatch: mocks.findSavedBatch,
}));

import { POST } from "@/app/api/tg/log/route";

/** The fixed vector from `init-data.test.ts`, so the real gate runs rather than a stub of it. */
const BOT_TOKEN = "123456:TEST-BOT-TOKEN-NOT-REAL";
const USER_JSON = '{"id":42424242,"first_name":"Chris","username":"Chris_Dev","language_code":"en"}';
const AUTH_DATE_SECONDS = 1757289600;
const VALID_HASH = "75d8d2d3db93a979238d51f3188460176c0b66b797192ca329f7e5ca1df2d5ae";

const INIT_DATA =
  `auth_date=${AUTH_DATE_SECONDS}` +
  `&query_id=AAF_test_query` +
  `&user=${encodeURIComponent(USER_JSON)}` +
  `&hash=${VALID_HASH}`;

const BATCH_ID = "11111111-2222-4333-8444-555555555555";

const CATEGORIES = [
  { id: "transportation", name: "Transportation", type: "EXPENSE", icon: "Car", color: "#000", isDefault: true },
  { id: "food", name: "Food & Dining", type: "EXPENSE", icon: "Utensils", color: "#000", isDefault: true },
  { id: "other", name: "Other Expense", type: "EXPENSE", icon: "Tag", color: "#000", isDefault: true },
];

const post = (body: unknown, authorization: string | null = `tma ${INIT_DATA}`) =>
  POST(
    new Request("https://example.test/api/tg/log", {
      method: "POST",
      headers: authorization ? { authorization, "content-type": "application/json" } : {},
      body: JSON.stringify(body),
    })
  );

const validBody = (over: Record<string, unknown> = {}) => ({
  description: "fare to office",
  amount: 38,
  clientBatchId: BATCH_ID,
  ...over,
});

const written = () => mocks.createTransactionBatch.mock.calls.at(-1)![0];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(AUTH_DATE_SECONDS * 1000 + 30_000));

  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  process.env.TELEGRAM_ALLOWED_IDS = "42424242";
  process.env.TELEGRAM_ALLOWED_USERNAMES = "";

  mocks.userFindUnique.mockResolvedValue({ id: "user_1" });
  mocks.categoryFindMany.mockResolvedValue(CATEGORIES);
  mocks.tileFindFirst.mockResolvedValue(null);
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
        labels: [{ label: { name: "Work" } }],
      },
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/tg/log: the gate", () => {
  it("refuses a request with no initData", async () => {
    const res = await post(validBody(), null);

    expect(res.status).toBe(401);
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });

  it("refuses a tampered payload", async () => {
    const res = await post(validBody(), `tma ${INIT_DATA.replace("42424242", "99999999")}`);

    expect(res.status).toBe(401);
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });

  it("refuses an id that is not on the allowlist", async () => {
    process.env.TELEGRAM_ALLOWED_IDS = "777";

    expect((await post(validBody())).status).toBe(401);
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/tg/log: the write", () => {
  it("writes one row as TELEGRAM with no MCP token", async () => {
    const res = await post(validBody());

    expect(res.status).toBe(201);
    expect(written().createdVia).toBe("TELEGRAM");
    // Not merely undefined: the key must be absent, because a stale token id is a confidently
    // wrong answer about who wrote the row rather than a gap in the trail.
    expect("mcpTokenId" in written()).toBe(false);
    expect(written().items).toHaveLength(1);
  });

  it("omits labelIds entirely so schedules run", async () => {
    await post(validBody());

    // `undefined` lets auto-apply schedules run; `[]` is an explicit opt-out. The distinction is
    // load-bearing, and a key present with an empty array would silently disable auto-labelling.
    expect("labelIds" in written().items[0]).toBe(false);
  });

  it("passes the idempotency key through", async () => {
    await post(validBody());

    expect(written().clientBatchId).toBe(BATCH_ID);
  });

  it("returns 200 rather than 201 on a replay", async () => {
    mocks.createTransactionBatch.mockResolvedValue({
      ok: true,
      replayed: true,
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

    const res = await post(validBody());

    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
  });

  it("stamps the server's clock, ignoring anything the client sends", async () => {
    // The webview's clock is not ours, and a real timestamp is what lets label schedules run.
    await post(validBody({ date: "2020-01-01T00:00:00.000Z" }));

    expect(written().items[0].date).toBe(new Date().toISOString());
  });

  it("answers 500, not 4xx, when the write outcome is unknown", async () => {
    // A 4xx tells the client nothing was written, so it drops its idempotency pin and a retry
    // writes a second row. Unknown has to read as retryable-under-the-same-key.
    mocks.createTransactionBatch.mockResolvedValue({
      ok: false,
      reason: "UNKNOWN_WHETHER_SAVED",
    });

    expect((await post(validBody())).status).toBe(500);
  });
});

describe("POST /api/tg/log: a replay is not judged on references it never uses", () => {
  /** What `findSavedBatch` returns for a batch that already committed. */
  const saved = [
    {
      id: "tx_original",
      amount: 38,
      description: "fare to office",
      category: { name: "Transportation" },
      labels: [{ label: { name: "Work" } }],
    },
  ];

  it("returns the saved batch even when the tile it names is gone", async () => {
    // The failure this prevents: the first write commits, its response is lost, and the tile is
    // deleted before the retry. Resolving the tile first would 404 a batch that is already saved,
    // the client would read that 4xx as proof nothing was written, drop its idempotency pin, and
    // a corrected resubmit under a fresh key would duplicate a real transaction.
    mocks.findSavedBatch.mockResolvedValue(saved);
    mocks.tileFindFirst.mockResolvedValue(null);

    const res = await post(validBody({ tileId: "since_deleted" }));

    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("tx_original");
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });

  it("returns the saved batch even when no category can be resolved", async () => {
    // Same rule, the other 4xx this route can raise before writing.
    mocks.findSavedBatch.mockResolvedValue(saved);
    mocks.categoryFindMany.mockResolvedValue([]);

    const res = await post(validBody({ description: "misc thing" }));

    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
  });

  it("reports the category the row actually carries, and admits it cannot say how", async () => {
    // `categoryVia` describes a decision made on the original request, which this one did not
    // make. Re-deriving it could disagree with what was really written, so the stored name is
    // reported and the inference is left null rather than guessed at.
    mocks.findSavedBatch.mockResolvedValue(saved);

    const body = await (await post(validBody())).json();

    expect(body.categoryName).toBe("Transportation");
    expect(body.categoryVia).toBeNull();
  });

  it("looks the key up before touching anything mutable", async () => {
    mocks.findSavedBatch.mockResolvedValue(saved);

    await post(validBody({ tileId: "tile_1" }));

    expect(mocks.tileFindFirst).not.toHaveBeenCalled();
  });

  it("falls through to a normal write when the key matches nothing", async () => {
    mocks.findSavedBatch.mockResolvedValue([]);

    expect((await post(validBody())).status).toBe(201);
    expect(mocks.createTransactionBatch).toHaveBeenCalled();
  });
});

describe("POST /api/tg/log: the tile is the authority", () => {
  it("ignores a client amount when the tile carries a fixed one", async () => {
    // Same rule `settleBill` applies to a fixed bill: the stored figure is the one the user chose,
    // and a stale client must not write a payment that disagrees with the button it came from.
    mocks.tileFindFirst.mockResolvedValue({
      description: "fare to office",
      amount: 38,
      type: "EXPENSE",
      categoryId: "transportation",
    });

    await post(validBody({ tileId: "tile_1", amount: 9999, description: "something else" }));

    expect(written().items[0].amount).toBe(38);
    expect(written().items[0].description).toBe("fare to office");
  });

  it("takes the client amount when the tile asks for one", async () => {
    mocks.tileFindFirst.mockResolvedValue({
      description: "lunch at work",
      amount: null,
      type: "EXPENSE",
      categoryId: "food",
    });

    await post(validBody({ tileId: "tile_2", amount: 180 }));

    expect(written().items[0].amount).toBe(180);
    expect(written().items[0].categoryId).toBe("food");
  });

  it("404s a tile belonging to someone else", async () => {
    // 404 rather than 403: confirming that somebody else's tile exists is itself an answer.
    mocks.tileFindFirst.mockResolvedValue(null);

    expect((await post(validBody({ tileId: "someone_elses" }))).status).toBe(404);
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/tg/log: the category", () => {
  it("derives one from the description when the tile has none", async () => {
    await post(validBody({ description: "fare to office" }));

    expect(written().items[0].categoryId).toBe("transportation");
    expect((await (await post(validBody())).json()).categoryVia).toBe("matched");
  });

  it("falls back to Other Expense when nothing matches", async () => {
    const res = await post(validBody({ description: "misc thing" }));

    expect(written().items[0].categoryId).toBe("other");
    // Named on the reply, because a fallback the user cannot see is one they cannot correct.
    expect((await res.json()).categoryVia).toBe("other");
  });

  it("refuses rather than picking the first category", async () => {
    // The Education bug: the list is ordered defaults-first then alphabetically, so
    // `categories[0]` filed every unresolved expense under whatever sorted first.
    mocks.categoryFindMany.mockResolvedValue(
      CATEGORIES.filter((c) => c.name !== "Other Expense")
    );

    expect((await post(validBody({ description: "misc thing" }))).status).toBe(409);
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/tg/log: validation", () => {
  it("rejects a non-positive amount", async () => {
    expect((await post(validBody({ amount: 0 }))).status).toBe(400);
    expect((await post(validBody({ amount: -5 }))).status).toBe(400);
    expect(mocks.createTransactionBatch).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed idempotency key", async () => {
    // The key is what makes a retry replay instead of writing a second row, so it is required
    // rather than optional here -- unlike the batch route, whose browser client can decide.
    expect((await post({ description: "x", amount: 1 })).status).toBe(400);
    expect((await post(validBody({ clientBatchId: "not-a-uuid" }))).status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await POST(
      new Request("https://example.test/api/tg/log", {
        method: "POST",
        headers: { authorization: `tma ${INIT_DATA}` },
        body: "not json",
      })
    );

    expect(res.status).toBe(400);
  });
});
