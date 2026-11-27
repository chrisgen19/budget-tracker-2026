import { act, renderHook } from "@testing-library/react";
import type { PointerEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReceiptPhotoZoom } from "@/hooks/use-receipt-photo-zoom";

/** One ResizeObserver, captured so the test can say when the frame changed size. */
let resized: (() => void) | null = null;
class FakeResizeObserver {
  constructor(callback: () => void) {
    resized = callback;
  }
  observe() {}
  disconnect() {
    resized = null;
  }
}

const frameOfSize = (width: number, height: number) => {
  const frame = document.createElement("div");
  Object.defineProperty(frame, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(frame, "clientHeight", { configurable: true, value: height });
  return frame;
};

const pointer = (id: number, x: number, y: number) =>
  ({
    pointerId: id,
    clientX: x,
    clientY: y,
    currentTarget: { setPointerCapture: () => {} },
  }) as unknown as PointerEvent<HTMLElement>;

afterEach(() => {
  vi.unstubAllGlobals();
  resized = null;
});

describe("useReceiptPhotoZoom", () => {
  // The pointer handlers were switched off while blurred, but the native wheel listener was not,
  // so scrolling over a hidden photo zoomed it and swallowed the scroll.
  it("leaves the wheel alone while disabled, so a blurred photo neither zooms nor eats the scroll", () => {
    const frame = frameOfSize(800, 600);
    const { result } = renderHook(() => useReceiptPhotoZoom({ current: frame }, false));
    const wheel = new WheelEvent("wheel", { deltaY: -2000, cancelable: true });

    act(() => {
      frame.dispatchEvent(wheel);
    });

    expect(result.current.style.scale.get()).toBe(1);
    expect(wheel.defaultPrevented).toBe(false);
  });

  it("zooms on the wheel once enabled", () => {
    const frame = frameOfSize(800, 600);
    const { result } = renderHook(() => useReceiptPhotoZoom({ current: frame }, true));

    act(() => {
      frame.dispatchEvent(new WheelEvent("wheel", { deltaY: -2000, cancelable: true }));
    });

    expect(result.current.style.scale.get()).toBe(5);
  });

  // At 5x an 800px frame lets the photo move 1600px; narrowed to 400px the limit is 800px. The
  // stored offset stayed at 1600 and the photo sat off the frame until the next gesture.
  it("pulls a zoomed photo back inside its frame when the frame shrinks", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const frame = frameOfSize(800, 600);
    const { result } = renderHook(() => useReceiptPhotoZoom({ current: frame }));

    act(() => {
      frame.dispatchEvent(new WheelEvent("wheel", { deltaY: -2000, cancelable: true }));
    });
    act(() => {
      result.current.handlers.onPointerDown(pointer(1, 0, 0));
      result.current.handlers.onPointerMove(pointer(1, 5000, 0));
      result.current.handlers.onPointerUp(pointer(1, 5000, 0));
    });
    expect(result.current.style.x.get()).toBe(1600);

    Object.defineProperty(frame, "clientWidth", { configurable: true, value: 400 });
    act(() => resized?.());

    expect(result.current.style.x.get()).toBe(800);
  });
});
