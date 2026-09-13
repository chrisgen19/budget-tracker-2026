import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  labelFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { label: { findMany: mocks.labelFindMany } },
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
