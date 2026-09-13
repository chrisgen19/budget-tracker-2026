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
 * Pins the cutover shim in `GET /api/labels`, which has no other coverage.
 *
 * `categories: []` is there so a tab still running the pre-revert bundle survives the deploy: that
 * bundle reads `lbl.categories.length` on the labels page and `label.categories.map(...)` in
 * `useScheduledLabel`, and both throw on undefined. Its removal is already scheduled as part of the
 * #303 follow-up, which is exactly why it needs a test -- deleting it early, or landing that PR
 * before this one has deployed, otherwise keeps the suite green and white-screens the first person
 * who left the app in a background tab.
 */
describe("GET /api/labels", () => {
  it("returns an empty categories array on every label, for stale clients", async () => {
    mocks.labelFindMany.mockResolvedValue([label("a"), label("b")]);

    const body = await (await GET()).json();

    expect(body).toHaveLength(2);
    for (const row of body) {
      expect(row).toHaveProperty("categories");
      expect(row.categories).toEqual([]);
    }
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
