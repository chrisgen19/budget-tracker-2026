import { describe, expect, it } from "vitest";
import { clampPan, panBounds } from "@/components/transactions/receipt-photo-pan";

describe("panBounds", () => {
  it("allows no pan at fit", () => {
    expect(panBounds(400, 600, 1)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  // The regression: a ref constraint gave 0 on every axis whatever the zoom.
  it("lets a 2x photo move half its overhang each way", () => {
    expect(panBounds(400, 600, 2)).toEqual({ left: -200, right: 200, top: -300, bottom: 300 });
  });

  it("grows with the zoom", () => {
    expect(panBounds(400, 600, 4)).toEqual({ left: -600, right: 600, top: -900, bottom: 900 });
  });
});

describe("clampPan", () => {
  it("pulls an offset from a corner at 3x back inside the 2x bounds", () => {
    const corner = panBounds(400, 600, 3); // ±400 / ±600
    expect(clampPan(corner.right, corner.top, panBounds(400, 600, 2))).toEqual({ x: 200, y: -300 });
  });

  it("leaves an offset already inside the bounds alone", () => {
    expect(clampPan(-50, 120, panBounds(400, 600, 2))).toEqual({ x: -50, y: 120 });
  });

  it("recentres at fit", () => {
    expect(clampPan(-150, 80, panBounds(400, 600, 1))).toEqual({ x: 0, y: 0 });
  });
});
