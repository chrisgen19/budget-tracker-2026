import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  labelFindMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { label: { findMany: mocks.labelFindMany }, $queryRaw: mocks.queryRaw },
}));
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

import { NextResponse } from "next/server";

import { GET } from "@/app/api/labels/route";

const label = (id: string) => ({
  id,
  name: `Label ${id}`,
  color: "#2D8B5A",
  applicableTo: "EXPENSE",
  userId: "user-1",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  _count: { transactions: 3 },
  schedules: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUserId.mockResolvedValue("user-1");
  mocks.queryRaw.mockResolvedValue([]);
});

/**
 * Coverage for `GET /api/labels`, which had none before #304.
 *
 * The cutover shim this file was originally written for -- `categories: []`, kept so a tab running
 * the pre-revert bundle survived the deploy -- is gone with the rest of the feature, and its test
 * with it. What remains is the shape the current client depends on and the ordering of the auth
 * check, neither of which was pinned anywhere.
 */
describe("GET /api/labels", () => {
  it("rolls per-category usage up onto each label", async () => {
    mocks.labelFindMany.mockResolvedValue([label("a"), label("b")]);
    mocks.queryRaw.mockResolvedValue([
      { labelId: "a", categoryId: "cat-food", n: 12 },
      { labelId: "a", categoryId: "cat-transport", n: 3 },
      { labelId: "b", categoryId: "cat-food", n: 5 },
    ]);

    const body = await (await GET()).json();

    expect(body.find((l: { id: string }) => l.id === "a").categoryCounts).toEqual({
      "cat-food": 12,
      "cat-transport": 3,
    });
    expect(body.find((l: { id: string }) => l.id === "b").categoryCounts).toEqual({
      "cat-food": 5,
    });
  });

  it("gives a never-used label an empty map rather than omitting the field", async () => {
    // The picker reads `label.categoryCounts[id] ?? 0`. Omitting the key for a label with no
    // history would make that a property access on undefined -- and the label would vanish from
    // the chips it should merely sort below.
    mocks.labelFindMany.mockResolvedValue([label("a"), label("unused")]);
    mocks.queryRaw.mockResolvedValue([{ labelId: "a", categoryId: "cat-food", n: 1 }]);

    const body = await (await GET()).json();

    expect(body.find((l: { id: string }) => l.id === "unused").categoryCounts).toEqual({});
  });

  it("keeps the fields the current client reads", async () => {
    mocks.labelFindMany.mockResolvedValue([label("a")]);

    const [row] = await (await GET()).json();

    expect(row).toMatchObject({ id: "a", name: "Label a", applicableTo: "EXPENSE" });
    expect(row._count.transactions).toBe(3);
    expect(row.schedules).toEqual([]);
  });

  it("does not query the database before authenticating", async () => {
    // Must be a NextResponse: the route's guard is `userId instanceof NextResponse`, so a plain
    // Response would fall through and be treated as a user id.
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mocks.getAuthUserId.mockResolvedValue(unauthorized);

    expect(await GET()).toBe(unauthorized);
    expect(mocks.labelFindMany).not.toHaveBeenCalled();
  });
});
