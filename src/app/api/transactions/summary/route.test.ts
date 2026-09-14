import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  getAuthUserId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { transaction: { groupBy: mocks.groupBy } },
}));
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

import { GET } from "@/app/api/transactions/summary/route";

const request = (query = "period=monthly&from=2026-09-01&to=2026-09-30&tz=-480") =>
  new Request(`http://localhost/api/transactions/summary?${query}`);

const rows = (income: number | null, expense: number | null) =>
  [
    income === null ? null : { type: "INCOME", _sum: { amount: income }, _count: { _all: 4 } },
    expense === null ? null : { type: "EXPENSE", _sum: { amount: expense }, _count: { _all: 28 } },
  ].filter(Boolean);

describe("GET /api/transactions/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.groupBy.mockResolvedValue(rows(80000, 45230));
  });

  it("totals each side of the ledger and the net between them", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      type: "ALL",
      count: 32,
      income: 80000,
      expense: 45230,
      net: 34770,
    });
  });

  it("echoes the type it answered about, so nothing can read the figures under another", async () => {
    // The aggregate runs over a WHERE that already applied the type, so an expense
    // summary reports income: 0 meaning "excluded". A client holding it alongside a
    // newer filter would render that as a real "₱0.00 received". An omitted type
    // defaults to ALL, so the echo is the type the figures were built under rather
    // than a copy of the query string.
    const body = await (
      await GET(request("period=monthly&from=2026-09-01&to=2026-09-30&type=EXPENSE&tz=-480"))
    ).json();

    expect(body.type).toBe("EXPENSE");
  });

  it("refuses an unreadable type rather than widening it to ALL", async () => {
    // A silent default here would make the summary describe more rows than the list
    // shows, while still echoing a type the caller would trust. The list route
    // shares this parser and refuses the same way.
    const response = await GET(
      request("period=monthly&from=2026-09-01&to=2026-09-30&type=nonsense&tz=-480"),
    );

    expect(response.status).toBe(400);
    expect(mocks.groupBy).not.toHaveBeenCalled();
  });

  it("scopes the aggregate to the caller and the window the filters name", async () => {
    await GET(request("period=custom&from=2026-09-01&to=2026-09-30&type=EXPENSE&labelId=lbl-1&tz=-480"));

    const [{ where }] = mocks.groupBy.mock.calls[0];
    expect(where.userId).toBe("user-1");
    expect(where.type).toBe("EXPENSE");
    expect(where.labels).toEqual({ some: { labelId: "lbl-1" } });
    // Exclusive upper bound on the day after `to`, in the caller's timezone, so
    // the whole of the final day counts.
    expect(where.date.gte.toISOString()).toBe("2026-08-31T16:00:00.000Z");
    expect(where.date.lt.toISOString()).toBe("2026-09-30T16:00:00.000Z");
  });

  it("reads a missing side as zero rather than leaving it undefined", async () => {
    mocks.groupBy.mockResolvedValue(rows(null, 45230));

    expect(await (await GET(request())).json()).toEqual({
      type: "ALL",
      count: 28,
      income: 0,
      expense: 45230,
      net: -45230,
    });
  });

  it("rounds away the error a Float sum accumulates", async () => {
    // `amount` is a Float, so adding enough rows lands just off the real total and
    // the client renders the result as currency.
    mocks.groupBy.mockResolvedValue(rows(0.1 + 0.2, 45230.000000001));

    expect(await (await GET(request())).json()).toEqual({
      type: "ALL",
      count: 32,
      income: 0.3,
      expense: 45230,
      net: -45229.7,
    });
  });

  it("refuses a half-specified window rather than silently widening it", async () => {
    const response = await GET(request("period=monthly&from=2026-09-01&tz=-480"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid transaction filters" });
    expect(mocks.groupBy).not.toHaveBeenCalled();
  });

  it("reports a failed aggregate as a server error", async () => {
    mocks.groupBy.mockRejectedValue(new Error("connection lost"));
    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to load transaction summary" });
  });
});
