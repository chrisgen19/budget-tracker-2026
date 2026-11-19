import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScanFullPicker } from "@/components/scan-review/scan-full-picker";
import type { LabelWithCountAndSchedules, MultiScanItem } from "@/types";

const mocks = vi.hoisted(() => ({
  useCategoriesQuery: vi.fn(),
  useLabelsQuery: vi.fn(),
  useScheduledLabel: vi.fn(),
}));

vi.mock("@/hooks/use-categories", () => ({ useCategoriesQuery: mocks.useCategoriesQuery }));
vi.mock("@/hooks/use-labels", () => ({ useLabelsQuery: mocks.useLabelsQuery }));
vi.mock("@/hooks/use-scheduled-label", () => ({ useScheduledLabel: mocks.useScheduledLabel }));

const query = (data: unknown, overrides: Record<string, unknown> = {}) => ({
  data,
  isPending: false,
  isError: false,
  ...overrides,
});

const label = (id: string, name: string, applicableTo = "BOTH") =>
  ({
    id,
    name,
    color: "#2D8B5A",
    applicableTo,
    userId: "user-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    _count: { transactions: 0 },
    schedules: [],
    categoryCounts: {},
  }) as LabelWithCountAndSchedules;

const item = (data: Partial<NonNullable<MultiScanItem["data"]>> = {}): MultiScanItem => ({
  id: "r1",
  fileName: "receipt.jpg",
  status: "success",
  data: { description: "Mercury Drug", type: "EXPENSE", categoryId: "food", ...data },
});

beforeEach(() => {
  mocks.useCategoriesQuery.mockReturnValue(
    query([
      { id: "food", name: "Food", type: "EXPENSE", icon: "tag", color: "#C8702A" },
      { id: "health", name: "Health", type: "EXPENSE", icon: "tag", color: "#3B82F6" },
      { id: "pet", name: "Pet Care", type: "EXPENSE", icon: "tag", color: "#E05B8D" },
    ]),
  );
  mocks.useLabelsQuery.mockReturnValue(
    query([label("ess", "Essentials"), label("pay", "Payroll", "INCOME"), label("work", "Work")]),
  );
  mocks.useScheduledLabel.mockReturnValue({ scheduledLabelId: null });
});

const search = (value: string) =>
  fireEvent.change(screen.getByRole("searchbox"), { target: { value } });

describe("ScanFullPicker: category", () => {
  it("filters by name without case and picks, then closes", () => {
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    render(<ScanFullPicker item={item()} kind="category" onUpdate={onUpdate} onClose={onClose} />);
    search("PET");
    expect(screen.queryByRole("button", { name: "Food" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pet Care" }));
    expect(onUpdate).toHaveBeenCalledWith("r1", { categoryId: "pet" });
    expect(onClose).toHaveBeenCalled();
  });

  it("says so when nothing matches", () => {
    render(<ScanFullPicker item={item()} kind="category" onUpdate={vi.fn()} onClose={vi.fn()} />);
    search("zzz");
    expect(screen.getByText(/No categories match/)).toBeTruthy();
  });
});

describe("ScanFullPicker: labels", () => {
  it("lists only labels the receipt's type allows", () => {
    render(<ScanFullPicker item={item()} kind="labels" onUpdate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: "Payroll" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Work" })).toBeTruthy();
  });

  it("seeds the first toggle from the scheduled label and stays open", () => {
    mocks.useScheduledLabel.mockReturnValue({ scheduledLabelId: "work" });
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    render(<ScanFullPicker item={item()} kind="labels" onUpdate={onUpdate} onClose={onClose} />);
    const work = screen.getByRole("checkbox", { name: "Work, automatically applied by schedule" });
    expect(work).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Essentials" }));
    expect(onUpdate).toHaveBeenCalledWith("r1", { labelIds: ["work", "ess"] });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says so when nothing matches, and Done closes", () => {
    const onClose = vi.fn();
    render(<ScanFullPicker item={item()} kind="labels" onUpdate={vi.fn()} onClose={onClose} />);
    search("zzz");
    expect(screen.getByText(/No labels match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
