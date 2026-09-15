// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  saveBudgetPlan: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));
vi.mock("@/lib/budget-plans", () => ({
  BudgetPlanError: class BudgetPlanError extends Error {},
  saveBudgetPlan: mocks.saveBudgetPlan,
}));

import { PUT } from "@/app/api/budgets/[month]/route";

const request = (body: unknown, tz = -480) => new Request(`http://localhost/api/budgets/2026-09?tz=${tz}`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("PUT /api/budgets/[month]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.saveBudgetPlan.mockResolvedValue({ id: "plan-2", revision: 2 });
  });

  it("saves a complete validated revision", async () => {
    const body = { allocations: [{ categoryId: "food", amount: 5000, kind: "FLEXIBLE", rolloverEnabled: true }] };
    const response = await PUT(request(body), { params: Promise.resolve({ month: "2026-09" }) });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "plan-2", revision: 2 });
    expect(mocks.saveBudgetPlan).toHaveBeenCalledWith("user-1", "2026-09", -480, body);
  });

  it("rejects duplicate categories without writing", async () => {
    const allocation = { categoryId: "food", amount: 5000, kind: "FLEXIBLE", rolloverEnabled: false };
    const response = await PUT(request({ allocations: [allocation, allocation] }), {
      params: Promise.resolve({ month: "2026-09" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.saveBudgetPlan).not.toHaveBeenCalled();
  });
});
