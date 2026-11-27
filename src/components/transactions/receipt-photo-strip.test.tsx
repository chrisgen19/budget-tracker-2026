import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptPhotoStrip } from "@/components/transactions/receipt-photo-strip";

const mocks = vi.hoisted(() => ({ hideAmounts: false }));

vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => ({ hideAmounts: mocks.hideAmounts, toggleHideAmounts: () => {} }),
}));

beforeEach(() => {
  mocks.hideAmounts = false;
});

describe("ReceiptPhotoStrip", () => {
  it("blurs the photo while amounts are hidden, and a click reveals it", () => {
    mocks.hideAmounts = true;
    const onOpen = vi.fn();
    render(<ReceiptPhotoStrip src="/api/receipt-photos/p1" onOpen={onOpen} />);
    const image = screen.getByAltText("Receipt photo");
    expect(image.className).toContain("blur-md");

    fireEvent.click(screen.getByRole("button", { name: "Show photo" }));
    expect(image.className).not.toContain("blur-md");
    // Revealing is its own tap: it must not also open the viewer over a photo still unseen.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("is not blurred while amounts are shown", () => {
    render(<ReceiptPhotoStrip src="/api/receipt-photos/p1" />);
    expect(screen.getByAltText("Receipt photo").className).not.toContain("blur-md");
  });

  it("pulses while the photo loads, then fades it in", () => {
    const { container } = render(<ReceiptPhotoStrip src="/api/receipt-photos/p1" />);
    const image = screen.getByAltText("Receipt photo");
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(image.className).toContain("opacity-0");

    fireEvent.load(image);
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(image.className).toContain("opacity-100");
    expect(image.className).toContain("transition-opacity");
  });

  it("shows the error instead of the skeleton when the photo fails", () => {
    const { container } = render(<ReceiptPhotoStrip src="/api/receipt-photos/p1" />);
    fireEvent.error(screen.getByAltText("Receipt photo"));
    expect(screen.getByText("The photo couldn't load.")).toBeDefined();
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("loads afresh when a different photo is chosen", () => {
    const { container, rerender } = render(<ReceiptPhotoStrip src="/api/receipt-photos/p1" />);
    fireEvent.load(screen.getByAltText("Receipt photo"));
    rerender(<ReceiptPhotoStrip src="blob:new-photo" />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.getByAltText("Receipt photo").className).toContain("opacity-0");
  });

  it("offers Tap to open when it can open the viewer", () => {
    const onOpen = vi.fn();
    render(<ReceiptPhotoStrip src="/api/receipt-photos/p1" onOpen={onOpen} />);
    expect(screen.getByText("Tap to open")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open receipt photo" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
