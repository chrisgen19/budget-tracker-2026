import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScanQuickChips } from "@/components/scan-review/scan-quick-chips";
import type { LabelWithCountAndSchedules, MultiScanItem } from "@/types";

const mocks = vi.hoisted(() => ({
  useCategoriesQuery: vi.fn(),
  useQuickPreferencesQuery: vi.fn(),
  useLabelsQuery: vi.fn(),
  useQuickLabelsQuery: vi.fn(),
  useScheduledLabel: vi.fn(),
}));

vi.mock("@/hooks/use-categories", () => ({
  useCategoriesQuery: mocks.useCategoriesQuery,
  useQuickPreferencesQuery: mocks.useQuickPreferencesQuery,
}));
vi.mock("@/hooks/use-labels", () => ({
  useLabelsQuery: mocks.useLabelsQuery,
  useQuickLabelsQuery: mocks.useQuickLabelsQuery,
}));
vi.mock("@/hooks/use-scheduled-label", () => ({
  useScheduledLabel: mocks.useScheduledLabel,
}));

const query = (data: unknown, overrides: Record<string, unknown> = {}) => ({
  data,
  isPending: false,
  isError: false,
  ...overrides,
});

const category = (id: string, name: string, type = "EXPENSE") => ({
  id,
  name,
  type,
  icon: "tag",
  color: "#C8702A",
});

const label = (id: string, name: string, count = 0, applicableTo = "BOTH") =>
  ({
    id,
    name,
    color: "#2D8B5A",
    applicableTo,
    userId: "user-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    _count: { transactions: count },
    schedules: [],
    categoryCounts: {},
  }) as LabelWithCountAndSchedules;

const CATEGORIES = [
  category("food", "Food"),
  category("groc", "Groceries"),
  category("health", "Health"),
  category("trans", "Transport"),
  category("pet", "Pet"),
  category("gift", "Gifts"),
];
const LABELS = [
  label("ess", "Essentials", 9),
  label("shared", "Shared", 5),
  label("wants", "Wants", 3),
  label("work", "Work", 1),
  label("online", "Online", 0),
];

const item = (data: Partial<NonNullable<MultiScanItem["data"]>> = {}): MultiScanItem => ({
  id: "r1",
  fileName: "receipt.jpg",
  status: "success",
  data: {
    amount: 724,
    description: "Pet Lovers Centre",
    type: "EXPENSE",
    date: "2026-11-19T10:00:00",
    categoryId: "food",
    ...data,
  },
});

const renderChips = (scanItem: MultiScanItem, disabled = false) => {
  const onUpdate = vi.fn();
  const onMore = vi.fn();
  render(
    <ScanQuickChips item={scanItem} disabled={disabled} onUpdate={onUpdate} onMore={onMore} />,
  );
  return { onUpdate, onMore };
};

const categoryRow = () => screen.getByRole("group", { name: "Category" });
const labelRow = () => screen.getByRole("group", { name: "Labels" });

beforeEach(() => {
  mocks.useCategoriesQuery.mockReturnValue(query(CATEGORIES));
  mocks.useQuickPreferencesQuery.mockReturnValue(
    query({ quickExpenseCategories: ["food", "groc", "health", "trans"], quickIncomeCategories: [] }),
  );
  mocks.useLabelsQuery.mockReturnValue(query(LABELS));
  mocks.useQuickLabelsQuery.mockReturnValue(query([]));
  mocks.useScheduledLabel.mockReturnValue({ scheduledLabelId: null });
});

describe("ScanQuickChips", () => {
  it("writes the tapped category", () => {
    const { onUpdate } = renderChips(item());
    fireEvent.click(within(categoryRow()).getByRole("button", { name: "Groceries" }));
    expect(onUpdate).toHaveBeenCalledWith("r1", { categoryId: "groc" });
  });

  it("asks for categories of the receipt's own type", () => {
    renderChips(item({ type: "INCOME" }));
    expect(mocks.useCategoriesQuery).toHaveBeenCalledWith("INCOME");
  });

  it("shows a category outside the quick four first, selected", () => {
    renderChips(item({ categoryId: "pet" }));
    const chips = within(categoryRow()).getAllByRole("button");
    expect(chips[0]).toHaveProperty("textContent", "Pet");
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the scheduled label on an untouched receipt and keeps it on the first tap", () => {
    mocks.useScheduledLabel.mockReturnValue({ scheduledLabelId: "work" });
    const { onUpdate } = renderChips(item());
    const work = within(labelRow()).getByRole("button", { name: /Work/ });
    expect(work.getAttribute("aria-pressed")).toBe("true");
    expect(work.getAttribute("aria-label")).toContain("automatically applied");
    fireEvent.click(within(labelRow()).getByRole("button", { name: "Essentials" }));
    expect(onUpdate).toHaveBeenCalledWith("r1", { labelIds: ["work", "ess"] });
  });

  it("adds to an explicit empty list and removes a chosen label", () => {
    const first = renderChips(item({ labelIds: [] }));
    fireEvent.click(within(labelRow()).getByRole("button", { name: "Shared" }));
    expect(first.onUpdate).toHaveBeenCalledWith("r1", { labelIds: ["shared"] });
  });

  it("removes a label that is already chosen", () => {
    const { onUpdate } = renderChips(item({ labelIds: ["ess", "shared"] }));
    fireEvent.click(within(labelRow()).getByRole("button", { name: "Essentials" }));
    expect(onUpdate).toHaveBeenCalledWith("r1", { labelIds: ["shared"] });
  });

  it("disables every chip while the row cannot be edited", () => {
    renderChips(item(), true);
    for (const chip of screen.getAllByRole("button")) {
      expect(chip).toHaveProperty("disabled", true);
    }
  });

  it("opens the full pickers from the More chips", () => {
    const { onMore } = renderChips(item());
    fireEvent.click(screen.getByRole("button", { name: "More categories" }));
    fireEvent.click(screen.getByRole("button", { name: "More labels" }));
    expect(onMore.mock.calls).toEqual([["category"], ["labels"]]);
  });

  it("shows placeholders while categories load and nothing when they fail", () => {
    mocks.useCategoriesQuery.mockReturnValue(query(undefined, { isPending: true }));
    const { unmount } = render(
      <ScanQuickChips item={item()} disabled={false} onUpdate={vi.fn()} onMore={vi.fn()} />,
    );
    expect(screen.getByLabelText("Loading categories")).toBeTruthy();
    unmount();
    mocks.useCategoriesQuery.mockReturnValue(query(undefined, { isError: true }));
    renderChips(item());
    expect(screen.queryByRole("group", { name: "Category" })).toBeNull();
  });
});
