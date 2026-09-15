// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  getBudgetPerformance: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getAuthUserId: mocks.getAuthUserId }));
vi.mock("@/lib/budget-plans", () => ({ getBudgetPerformance: mocks.getBudgetPerformance }));

import { GET } from "@/app/api/budgets/route";

describe("GET /api/budgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUserId.mockResolvedValue("user-1");
    mocks.getBudgetPerformance.mockResolvedValue({ month: "2026-09" });
  });

  it("loads the authenticated user's month in their timezone", async () => {
    const response = await GET(new Request("http://localhost/api/budgets?month=2026-09&tz=-480"));

    expect(response.status).toBe(200);
    expect(mocks.getBudgetPerformance).toHaveBeenCalledWith("user-1", "2026-09", -480);
  });

  it("rejects invalid months and timezone offsets before querying", async () => {
    for (const query of ["month=2026-13&tz=-480", "month=2026-09&tz=900"]) {
      const response = await GET(new Request(`http://localhost/api/budgets?${query}`));
      expect(response.status).toBe(400);
    }
    expect(mocks.getBudgetPerformance).not.toHaveBeenCalled();
  });
});
