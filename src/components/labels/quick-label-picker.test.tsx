import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuickLabelPicker } from "@/components/labels/quick-label-picker";
import type { LabelWithCountAndSchedules } from "@/types";

const label = (id: string, name: string): LabelWithCountAndSchedules => ({
  id,
  name,
  color: "#F5A623",
  applicableTo: "BOTH",
  userId: "user-1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  _count: { transactions: 0 },
  schedules: [],
});

const LABELS = [label("alpha", "Alpha"), label("beta", "Beta"), label("gamma", "Gamma")];

const renderPicker = (selectedIds: string[] = []) => {
  const onSave = vi.fn();
  render(
    <QuickLabelPicker
      selectedIds={selectedIds}
      allLabels={LABELS}
      onSave={onSave}
      onCancel={() => {}}
    />,
  );
  return { onSave };
};

describe("QuickLabelPicker", () => {
  it("names an unselected label by its name alone", () => {
    renderPicker();

    expect(screen.getByRole("button", { name: "Alpha", pressed: false })).toBeDefined();
  });

  it("announces the selection position, which is otherwise only a decorative badge", () => {
    renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Gamma" }));
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));

    expect(
      screen.getByRole("button", { name: "Gamma, position 1 of 2", pressed: true }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Alpha, position 2 of 2", pressed: true }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Beta", pressed: false })).toBeDefined();
  });

  it("renumbers the remaining selections when one is removed", () => {
    renderPicker(["alpha", "beta", "gamma"]);

    fireEvent.click(screen.getByRole("button", { name: "Alpha, position 1 of 3" }));

    expect(screen.getByRole("button", { name: "Beta, position 1 of 2" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Gamma, position 2 of 2" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Alpha", pressed: false })).toBeDefined();
  });

  it("saves the pinned labels in selection order", () => {
    const { onSave } = renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Gamma" }));
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(["gamma", "beta"]);
  });
});
