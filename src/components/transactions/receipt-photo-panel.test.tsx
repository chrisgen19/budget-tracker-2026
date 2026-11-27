import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReceiptPhotoPanel } from "@/components/transactions/receipt-photo-panel";

vi.mock("@/components/transactions/receipt-photo-reveal", () => ({
  usePhotoReveal: () => ({ blurred: false, reveal: () => {} }),
  PhotoRevealCover: () => null,
}));

/** The panel's one ResizeObserver, captured so the test can say when the frame changed size. */
let resized: (() => void) | null = null;
class FakeResizeObserver {
  constructor(callback: () => void) {
    resized = callback;
  }
  observe() {}
  disconnect() {}
}

const setFrameSize = (frame: HTMLElement, width: number, height: number) => {
  Object.defineProperty(frame, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(frame, "clientHeight", { configurable: true, value: height });
};

/** The `translateX` framer-motion wrote onto the image, in px. */
const translateX = (img: HTMLElement) => Number(/translateX\((-?[\d.]+)px\)/.exec(img.style.transform)?.[1] ?? 0);

afterEach(() => {
  vi.unstubAllGlobals();
  resized = null;
});

describe("ReceiptPhotoPanel", () => {
  // A zoom step animates the offset. A resize mid-animation clamped it with `set`, which left the
  // animation running, and the animation then wrote its old target back, past the new edge.
  it("keeps the clamp a resize applies even while a zoom step is still animating", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(<ReceiptPhotoPanel src="blob:receipt" />);
    const img = screen.getByAltText("Receipt photo");
    const frame = img.parentElement as HTMLElement;
    setFrameSize(frame, 400, 400);
    fireEvent.load(img);

    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    fireEvent.click(zoomIn);
    fireEvent.click(zoomIn);
    fireEvent.click(zoomIn);
    fireEvent.click(zoomIn); // 3x: the photo may move 400px either way
    await act(async () => new Promise((r) => setTimeout(r, 600)));
    for (let i = 0; i < 8; i++) fireEvent.keyDown(frame, { key: "ArrowRight" }); // x = -320

    // Zoom out a step, which animates the offset toward -300 (the 2.5x bound), and shrink the
    // frame before that animation lands: the new bound is 75.
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    setFrameSize(frame, 100, 100);
    act(() => resized?.());
    await act(async () => new Promise((r) => setTimeout(r, 800)));

    expect(translateX(img)).toBeGreaterThanOrEqual(-75);
  });

  // An arrow press during a zoom step used `set`, which left the zoom's offset animation running,
  // and the animation then landed on its old target and undid the press.
  it("keeps an arrow press made while a zoom step is still animating", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    render(<ReceiptPhotoPanel src="blob:receipt" />);
    const img = screen.getByAltText("Receipt photo");
    const frame = img.parentElement as HTMLElement;
    setFrameSize(frame, 400, 400);
    fireEvent.load(img);

    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    for (let i = 0; i < 4; i++) fireEvent.click(zoomIn); // 3x: ±400
    await act(async () => new Promise((r) => setTimeout(r, 600)));
    for (let i = 0; i < 8; i++) fireEvent.keyDown(frame, { key: "ArrowRight" }); // x = -320

    // Zoom out a step: the offset animates toward -300 (the 2.5x bound). Press left mid-flight.
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.keyDown(frame, { key: "ArrowLeft" });
    await act(async () => new Promise((r) => setTimeout(r, 800)));

    // The press moved it 40 to the right of where it stood, and nothing put it back to -300.
    expect(translateX(img)).toBeGreaterThan(-300);
  });
});
