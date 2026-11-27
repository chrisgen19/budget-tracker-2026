import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptPhotoViewer } from "@/components/transactions/receipt-photo-viewer";

type InfoState = { data?: unknown; isLoading: boolean; isError: boolean };

const mocks = vi.hoisted(() => ({
  hideAmounts: false,
  info: { isLoading: false, isError: false } as InfoState,
}));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP" } }),
}));
vi.mock("@/components/privacy-provider", () => ({
  usePrivacy: () => ({ hideAmounts: mocks.hideAmounts, toggleHideAmounts: () => {} }),
}));
vi.mock("@/hooks/use-receipt-photos", () => ({
  receiptPhotoUrl: (id: string) => `/api/receipt-photos/${id}`,
  useReceiptPhotoInfo: () => mocks.info,
}));

/** The split SM receipt from the mockup: one photo, two rows. */
const SPLIT_INFO = {
  photo: { id: "photo_1", width: 900, height: 1500, byteSize: 120000, contentType: "image/avif", createdAt: "2026-11-26T03:59:00.000Z" },
  transactions: [
    { id: "t1", description: "SM Groceries", amount: 190.95, type: "EXPENSE", categoryName: "Groceries", localDate: "2026-11-26" },
    { id: "t2", description: "SM Home", amount: 205, type: "EXPENSE", categoryName: "Home Supplies", localDate: "2026-11-26" },
  ],
  total: 395.95,
};

const rowText = (label: string) => screen.getByText(label).closest("li")?.textContent ?? "";

beforeEach(() => {
  mocks.hideAmounts = false;
  mocks.info = { data: SPLIT_INFO, isLoading: false, isError: false };
});

describe("ReceiptPhotoViewer", () => {
  it("lists every row the photo is attached to, with the receipt total", () => {
    render(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} />);
    expect(rowText("Groceries")).toContain("₱190.95");
    expect(rowText("Home Supplies")).toContain("₱205.00");
    expect(rowText("Receipt total")).toContain("₱395.95");
  });

  it("downloads the stored photo through the owner-checked route", () => {
    render(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} />);
    const link = screen.getByRole("link", { name: /download/i });
    expect(link.getAttribute("href")).toBe("/api/receipt-photos/photo_1");
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("names the download after the stored format", () => {
    render(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /download/i }).getAttribute("download")).toBe("receipt-2026-11-26.avif");
  });

  it("keeps .jpg for a photo stored before the AVIF switch", () => {
    mocks.info = { data: { ...SPLIT_INFO, photo: { ...SPLIT_INFO.photo, contentType: "image/jpeg" } }, isLoading: false, isError: false };
    render(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /download/i }).getAttribute("download")).toBe("receipt-2026-11-26.jpg");
  });

  it("leaves the extension off until the photo's type is known", () => {
    mocks.info = { isLoading: true, isError: false };
    render(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} />);
    expect(screen.getByRole("link", { name: /download/i }).getAttribute("download")).toBe("receipt-photo_1");
  });

  it("is a named dialog that closes on Escape", () => {
    const onClose = vi.fn();
    render(<ReceiptPhotoViewer open photoId="photo_1" onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: /receipt/i })).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers Replace only when the caller can replace", () => {
    const onReplace = vi.fn();
    const { rerender } = render(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
    rerender(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} onReplace={onReplace} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(onReplace).toHaveBeenCalledTimes(1);
  });

  it("masks the amounts and blurs the photo while amounts are hidden", () => {
    mocks.hideAmounts = true;
    render(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} />);
    expect(rowText("Groceries")).not.toContain("190.95");
    expect(rowText("Receipt total")).toContain("••••••");
    const image = screen.getByAltText("Receipt photo");
    expect(image.className).toContain("blur-md");
    fireEvent.click(screen.getByRole("button", { name: "Show photo" }));
    expect(image.className).not.toContain("blur-md");
  });

  it("keeps the photo when the details fail to load", () => {
    mocks.info = { data: undefined, isLoading: false, isError: true };
    render(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} />);
    expect(screen.getByAltText("Receipt photo")).toBeDefined();
    expect(screen.getByText("The details couldn't be loaded.")).toBeDefined();
  });

  it("shows a quiet line while the details load", () => {
    mocks.info = { data: undefined, isLoading: true, isError: false };
    render(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} />);
    expect(screen.getByText("Loading details...")).toBeDefined();
  });

  it("says so when the image fails, rather than a broken image", () => {
    render(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} />);
    fireEvent.error(screen.getByAltText("Receipt photo"));
    expect(screen.queryByAltText("Receipt photo")).toBeNull();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("The photo couldn't load.")).toBeDefined();
  });

  it("pulses while the photo loads full screen, then fades it in", () => {
    render(<ReceiptPhotoViewer open photoId="photo_1" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const image = screen.getByAltText("Receipt photo");
    expect(dialog.querySelector(".animate-pulse")).not.toBeNull();
    expect(image.className).toContain("opacity-0");

    fireEvent.load(image);
    expect(dialog.querySelector(".animate-pulse")).toBeNull();
    expect(image.className).toContain("opacity-100");
  });

  it("renders nothing while closed", () => {
    render(<ReceiptPhotoViewer open={false} photoId="photo_1" onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
