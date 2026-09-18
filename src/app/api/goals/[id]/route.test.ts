import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  goalDeleteMany: vi.fn(),
  goalFindFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    savingsGoal: {
      deleteMany: mocks.goalDeleteMany,
      findFirst: mocks.goalFindFirst,
    },
  },
}));
vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));

import { DELETE } from "@/app/api/goals/[id]/route";

const context = { params: Promise.resolve({ id: "goal-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUserId.mockResolvedValue("user-1");
});

/**
 * The UI only offers Delete for a goal with no contributions, and that is a hint rather than the
 * rule: `onDelete: Cascade` takes the contributions with the goal, and the page the button was
 * rendered on goes stale the moment another tab records one. A request can also arrive with no
 * page at all.
 */
describe("DELETE /api/goals/[id]", () => {
  it("carries the no-history condition in the delete itself, not in a read before it", async () => {
    mocks.goalDeleteMany.mockResolvedValue({ count: 1 });

    const response = await DELETE(new Request("http://localhost/api/goals/goal-1"), context);

    expect(response.status).toBe(200);
    expect(mocks.goalDeleteMany).toHaveBeenCalledWith({
      where: { id: "goal-1", userId: "user-1", contributions: { none: {} } },
    });
    // Nothing is read to decide whether the delete may happen; the database decided.
    expect(mocks.goalFindFirst).not.toHaveBeenCalled();
  });

  it("refuses a goal that has gained contributions since the button was rendered", async () => {
    mocks.goalDeleteMany.mockResolvedValue({ count: 0 });
    mocks.goalFindFirst.mockResolvedValue({ id: "goal-1" });

    const response = await DELETE(new Request("http://localhost/api/goals/goal-1"), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Archive it instead") });
  });

  /** The same `count === 0`, a different cause, and the caller needs them apart. */
  it("still reports a goal that is not this user's as not found", async () => {
    mocks.goalDeleteMany.mockResolvedValue({ count: 0 });
    mocks.goalFindFirst.mockResolvedValue(null);

    const response = await DELETE(new Request("http://localhost/api/goals/goal-1"), context);

    expect(response.status).toBe(404);
    // Scoped on the owner here too, so the follow-up cannot confirm another account's goal exists.
    expect(mocks.goalFindFirst).toHaveBeenCalledWith({
      where: { id: "goal-1", userId: "user-1" },
      select: { id: true },
    });
  });
});
