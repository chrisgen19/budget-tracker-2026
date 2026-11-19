import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useScanReviewPicker } from "@/hooks/use-scan-review-picker";
import type { MultiScanItem } from "@/types";

const receipt = (id: string, status: MultiScanItem["status"] = "success"): MultiScanItem => ({
  id,
  fileName: `${id}.jpg`,
  status,
  data: { description: "Pet Lovers Centre", amount: 724, type: "EXPENSE" },
});

const setup = (items: MultiScanItem[]) =>
  renderHook(({ list }) => useScanReviewPicker(list), { initialProps: { list: items } });

describe("useScanReviewPicker", () => {
  it("titles the sheet after the open picker, and the review otherwise", () => {
    const { result } = setup([receipt("r1")]);
    expect(result.current.title).toBe("Review Scanned Receipts");
    act(() => result.current.open("r1", "category"));
    expect(result.current.title).toBe("Category for Pet Lovers Centre");
    act(() => result.current.open("r1", "labels"));
    expect(result.current.title).toBe("Labels for Pet Lovers Centre");
  });

  it("closing the sheet with a picker open goes back to the list, not to discard", () => {
    const { result } = setup([receipt("r1")]);
    act(() => result.current.open("r1", "labels"));
    let intercepted = false;
    act(() => {
      intercepted = result.current.interceptClose();
    });
    expect(intercepted).toBe(true);
    expect(result.current.picker).toBeNull();
    expect(result.current.title).toBe("Review Scanned Receipts");
  });

  it("lets the close through when no picker is open", () => {
    const { result } = setup([receipt("r1")]);
    expect(result.current.interceptClose()).toBe(false);
  });

  it("drops a picker whose receipt was removed or is no longer a scanned row", () => {
    const { result, rerender } = setup([receipt("r1")]);
    act(() => result.current.open("r1", "category"));
    rerender({ list: [] });
    expect(result.current.picker).toBeNull();
    expect(result.current.interceptClose()).toBe(false);
    rerender({ list: [receipt("r1", "breaking_down")] });
    expect(result.current.picker).toBeNull();
  });

  it("names a receipt with no description generically", () => {
    const { result } = setup([{ ...receipt("r1"), data: { amount: 1 } }]);
    act(() => result.current.open("r1", "category"));
    expect(result.current.title).toBe("Category for this receipt");
  });
});
