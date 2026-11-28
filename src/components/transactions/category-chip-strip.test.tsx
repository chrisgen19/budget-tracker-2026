import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CategoryChipStrip } from "@/components/transactions/category-chip-strip";

const CATEGORIES = [
  { id: "c1", name: "Food", icon: "utensils", color: "#aa0000" },
  { id: "c2", name: "Transport", icon: "car", color: "#00aa00" },
  { id: "c3", name: "Bills", icon: "receipt", color: "#0000aa" },
];

function setup(overrides: Partial<React.ComponentProps<typeof CategoryChipStrip>> = {}) {
  const onPick = vi.fn();
  const onMore = vi.fn();
  render(
    <CategoryChipStrip
      categories={CATEGORIES}
      selectedId=""
      showMore
      onPick={onPick}
      onMore={onMore}
      {...overrides}
    />,
  );
  return { onPick, onMore };
}

describe("CategoryChipStrip", () => {
  it("renders one chip per category in order, then More…", () => {
    setup();
    const buttons = screen.getAllByRole("button");

    expect(buttons.map((b) => b.textContent)).toEqual(["Food", "Transport", "Bills", "More…"]);
  });

  it("hides More… when showMore is false", () => {
    setup({ showMore: false });

    expect(screen.queryByText("More…")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("marks the selected chip", () => {
    setup({ selectedId: "c2" });

    expect(screen.getByRole("button", { name: "Transport" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Food" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Bills" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onPick with the id", () => {
    const { onPick } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Bills" }));

    expect(onPick).toHaveBeenCalledWith("c3");
  });

  it("calls onMore", () => {
    const { onMore } = setup();
    fireEvent.click(screen.getByRole("button", { name: "More…" }));

    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it("keeps focus on pointerdown", () => {
    setup();

    expect(fireEvent.pointerDown(screen.getByRole("button", { name: "Food" }))).toBe(false);
    expect(fireEvent.pointerDown(screen.getByRole("button", { name: "More…" }))).toBe(false);
  });

  it("keeps focus on mousedown", () => {
    setup();

    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Food" }))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "More…" }))).toBe(false);
  });
});
