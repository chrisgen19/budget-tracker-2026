import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeriodPicker } from "@/components/ui/period-picker";
import type { PeriodSelection } from "@/lib/analytics-period";

/** UTC+8, the account timezone these tests reason in. */
const MANILA = -480;

const september: PeriodSelection = {
  periodType: "monthly",
  from: "2026-09-01",
  to: "2026-09-30",
};

const renderPicker = (props: Partial<Parameters<typeof PeriodPicker>[0]> = {}) => {
  const onChange = vi.fn();
  render(
    <PeriodPicker value={september} onChange={onChange} tz={MANILA} {...props} />,
  );
  return { onChange };
};

/** Modal focuses its content on a 50ms timer; flush it so open/close settles. */
const openPanel = () => {
  fireEvent.click(screen.getByRole("button", { name: /^Choose period/ }));
  act(() => {
    vi.advanceTimersByTime(60);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T04:00:00Z"));
});

describe("PeriodPicker trigger", () => {
  it("names the current period for a screen reader", () => {
    renderPicker();
    expect(
      screen.getByRole("button", { name: "Choose period, currently September 2026" }),
    ).toBeTruthy();
  });

  it("prefers a caller-supplied label over the derived one", () => {
    renderPicker({ label: "Fiscal Q3" });
    expect(screen.getByRole("button", { name: /currently Fiscal Q3/ })).toBeTruthy();
  });

  it("gives every control a 44px touch target", () => {
    renderPicker();
    for (const name of ["Previous period", "Next period"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("min-w-11");
    }
    expect(screen.getByRole("button", { name: /^Choose period/ }).className).toContain("min-h-11");
  });

  it("reports its expanded state", () => {
    renderPicker();
    const trigger = screen.getByRole("button", { name: /^Choose period/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    openPanel();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("PeriodPicker navigation", () => {
  it("steps a month and reports the resulting period type", () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Previous period" }));
    expect(onChange).toHaveBeenCalledWith({
      periodType: "monthly",
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("leaves All time for the account's current month", () => {
    // Without the reported type the caller would stay on "all" and the next press
    // would land on the current month again instead of advancing past it.
    const { onChange } = renderPicker({
      value: { periodType: "all", from: "", to: "" },
      allowAllTime: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Next period" }));
    expect(onChange).toHaveBeenCalledWith({
      periodType: "monthly",
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });
});

describe("PeriodPicker panel", () => {
  it("marks the active month as pressed", () => {
    renderPicker();
    openPanel();
    expect(screen.getByRole("button", { name: "Sep" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Aug" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("selects a month and closes", () => {
    const { onChange } = renderPicker();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Feb" }));
    expect(onChange).toHaveBeenCalledWith({
      periodType: "monthly",
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(screen.getByRole("button", { name: /^Choose period/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("lists the weeks overlapping the shown month", () => {
    const { onChange } = renderPicker();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Weeks" }));
    fireEvent.click(screen.getByRole("button", { name: "Sep 7 – Sep 13" }));
    expect(onChange).toHaveBeenCalledWith({
      periodType: "weekly",
      from: "2026-09-07",
      to: "2026-09-13",
    });
  });

  it("resolves a quick range in the account timezone", () => {
    const { onChange } = renderPicker();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Year to date" }));
    expect(onChange).toHaveBeenCalledWith({
      periodType: "custom",
      from: "2026-01-01",
      to: "2026-09-10",
    });
  });

  it("accepts a custom range entered backwards rather than refusing it", () => {
    const { onChange } = renderPicker();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-30" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply range" }));
    expect(onChange).toHaveBeenCalledWith({
      periodType: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });
});

describe("PeriodPicker panel follows the selection", () => {
  it("re-anchors the grid when the arrows move the period underneath it", () => {
    // The popover leaves the arrows reachable, so the selection can change while the
    // panel is mounted. Seeded-once state left the grid on the year it opened at with
    // no month highlighted.
    const onChange = vi.fn();
    const { rerender } = render(
      <PeriodPicker value={september} onChange={onChange} tz={MANILA} presentation="popover" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Choose period/ }));
    expect(screen.getByText("2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sep" }).getAttribute("aria-pressed")).toBe("true");

    rerender(
      <PeriodPicker
        value={{ periodType: "monthly", from: "2025-11-01", to: "2025-11-30" }}
        onChange={onChange}
        tz={MANILA}
        presentation="popover"
      />,
    );

    expect(screen.getByText("2025")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nov" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("leaves the grid alone for All time, which anchors nothing", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PeriodPicker value={september} onChange={onChange} tz={MANILA} presentation="popover" allowAllTime />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Choose period/ }));

    rerender(
      <PeriodPicker
        value={{ periodType: "all", from: "", to: "" }}
        onChange={onChange}
        tz={MANILA}
        presentation="popover"
        allowAllTime
      />,
    );

    expect(screen.getByText("2026")).toBeTruthy();
  });
});

describe("PeriodPicker dialog placement", () => {
  it("escapes a clipping, transformed ancestor", () => {
    // The transactions toolbar is overflow-hidden and carries a transform even at
    // rest, which makes it the containing block for position:fixed descendants —
    // so an in-place Modal resolves its full-viewport overlay against the toolbar
    // and gets clipped out of sight. Only a portal actually leaves.
    const onChange = vi.fn();
    const { container } = render(
      <div style={{ overflow: "hidden", transform: "translateY(0)" }}>
        <PeriodPicker value={september} onChange={onChange} tz={MANILA} />
      </div>,
    );
    openPanel();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });
});

describe("PeriodPicker All time", () => {
  it("is absent unless the surface allows it", () => {
    renderPicker();
    openPanel();
    expect(screen.queryByRole("button", { name: "All time" })).toBeNull();
  });

  it("emits an unbounded selection, carrying no stale range", () => {
    // The filter schema refuses All time that still has from/to, so the bounds
    // have to be cleared here rather than left for the caller to remember.
    const { onChange } = renderPicker({ allowAllTime: true });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(onChange).toHaveBeenCalledWith({ periodType: "all", from: "", to: "" });
  });
});
