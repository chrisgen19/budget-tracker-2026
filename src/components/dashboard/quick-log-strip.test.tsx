import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickTileView } from "@/lib/telegram/tile-queries";

const mocks = vi.hoisted(() => ({
  useQuickTilesQuery: vi.fn(),
  tap: vi.fn(),
}));

vi.mock("@/hooks/use-quick-tiles", () => ({
  useQuickTilesQuery: mocks.useQuickTilesQuery,
}));

// The tap engine has its own coverage in `pending-taps.test.ts`, and it is the *shared* one --
// stubbing it here keeps this file about the only decisions the strip makes for itself.
vi.mock("@/hooks/use-quick-tap", () => ({
  useQuickTap: () => ({
    tap: mocks.tap,
    asking: null,
    closeAsk: vi.fn(),
    submitAsk: vi.fn(),
    busy: false,
  }),
}));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP" } }),
}));

vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => ({ hideAmounts: false }),
}));

import { QuickLogStrip } from "@/components/dashboard/quick-log-strip";

const tile = (id: string, label: string, amount: number | null = 38): QuickTileView => ({
  id,
  label,
  description: label.toLowerCase(),
  amount,
  type: "EXPENSE",
  categoryId: "transportation",
  resolvedCategoryId: "transportation",
  resolvedCategoryName: "Transportation",
  fallsBack: false,
  labels: [],
  sortOrder: 10,
});

const loaded = (tiles: QuickTileView[]) => ({
  data: { tiles, limits: { maxTiles: 12 } },
  isError: false,
});

beforeEach(() => {
  mocks.useQuickTilesQuery.mockReset();
  mocks.tap.mockReset();
});

describe("when there is nothing to show", () => {
  it("renders nothing rather than an empty panel", () => {
    mocks.useQuickTilesQuery.mockReturnValue(loaded([]));
    const { container } = render(<QuickLogStrip />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the fetch failed", () => {
    // The case that matters. A failed fetch also leaves `tiles` empty, and an "add your first
    // button" panel here would report a network problem as a fact about the account -- while the
    // buttons sit on /quick-log, which distinguishes those two states carefully.
    mocks.useQuickTilesQuery.mockReturnValue({ data: undefined, isError: true });
    const { container } = render(<QuickLogStrip />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing while the query has not resolved", () => {
    mocks.useQuickTilesQuery.mockReturnValue({ data: undefined, isError: false });
    const { container } = render(<QuickLogStrip />);
    expect(container.innerHTML).toBe("");
  });
});

describe("the grid it shows", () => {
  it("stops at six and says how many there are", () => {
    const tiles = Array.from({ length: 9 }, (_, i) => tile(`t${i}`, `Button ${i}`));
    mocks.useQuickTilesQuery.mockReturnValue(loaded(tiles));

    render(<QuickLogStrip />);

    expect(screen.getByText("Button 5")).toBeDefined();
    expect(screen.queryByText("Button 6")).toBeNull();
    // Named rather than a bare arrow: the count is the reason to follow the link.
    expect(screen.getByRole("link", { name: /All 9/ })).toBeDefined();
  });

  it("keeps the order the user set, since that is the only control over what appears here", () => {
    mocks.useQuickTilesQuery.mockReturnValue(
      loaded([tile("a", "First"), tile("b", "Second"), tile("c", "Third")])
    );

    render(<QuickLogStrip />);

    const labels = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(labels[0]).toContain("First");
    expect(labels[2]).toContain("Third");
  });

  it("offers to manage rather than counting when they all fit", () => {
    mocks.useQuickTilesQuery.mockReturnValue(loaded([tile("a", "First")]));
    render(<QuickLogStrip />);
    expect(screen.getByRole("link", { name: /Manage/ })).toBeDefined();
  });
});

describe("tapping", () => {
  it("passes the whole tile to the shared tap engine", () => {
    const only = tile("a", "To office");
    mocks.useQuickTilesQuery.mockReturnValue(loaded([only]));

    render(<QuickLogStrip />);
    fireEvent.click(screen.getByRole("button", { name: /To office/ }));

    expect(mocks.tap).toHaveBeenCalledWith(only);
  });

  it("says a tile will ask rather than printing a figure it does not have", () => {
    mocks.useQuickTilesQuery.mockReturnValue(loaded([tile("a", "Lunch", null)]));
    render(<QuickLogStrip />);
    expect(screen.getByRole("button", { name: "Lunch, ask for an amount" })).toBeDefined();
  });
});
