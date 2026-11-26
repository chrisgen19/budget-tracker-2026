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

  it("offers Tap to open when it can open the viewer", () => {
    const onOpen = vi.fn();
    render(<ReceiptPhotoStrip src="/api/receipt-photos/p1" onOpen={onOpen} />);
    expect(screen.getByText("Tap to open")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open receipt photo" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
