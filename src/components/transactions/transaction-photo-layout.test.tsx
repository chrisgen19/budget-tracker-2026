import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { TransactionPhotoLayout } from "@/components/transactions/transaction-photo-layout";

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({ user: { currency: "PHP" } }),
}));
vi.mock("@/hooks/use-receipt-photos", () => ({
  receiptPhotoUrl: (id: string) => `/api/receipt-photos/${id}`,
  useReceiptPhotoInfo: (id: string | null) => ({
    data: id
      ? {
          photo: { id, width: 1, height: 1, byteSize: 1, createdAt: "2026-11-26T00:00:00.000Z" },
          transactions: [
            { id: "t1", description: "a", amount: 190.95, type: "EXPENSE", categoryName: "Groceries", localDate: "2026-11-26" },
            { id: "t2", description: "b", amount: 205, type: "EXPENSE", categoryName: "Home Supplies", localDate: "2026-11-26" },
          ],
          total: 395.95,
        }
      : undefined,
    isLoading: false,
    isError: false,
  }),
}));

/** Counts its own mounts, standing in for the form the layout wraps. */
const mounts = { count: 0 };
function MountCounter() {
  useEffect(() => {
    mounts.count++;
  }, []);
  return <p>form</p>;
}

describe("TransactionPhotoLayout", () => {
  // Bare children without a photo and wrapped children with one is a change of parent, and React
  // remounts across that: the form lost its local state and re-ran the amount autofocus, popping
  // a phone's keyboard, every time a photo was attached or removed.
  it("keeps the form mounted when a photo is attached and removed", () => {
    mounts.count = 0;
    const { rerender } = render(
      <TransactionPhotoLayout photoSrc={null}>
        <MountCounter />
      </TransactionPhotoLayout>,
    );
    rerender(
      <TransactionPhotoLayout photoSrc="blob:preview" photoId={null}>
        <MountCounter />
      </TransactionPhotoLayout>,
    );
    rerender(
      <TransactionPhotoLayout photoSrc={null}>
        <MountCounter />
      </TransactionPhotoLayout>,
    );

    expect(mounts.count).toBe(1);
  });

  it("opens the viewer from the strip for a stored photo, naming the other rows", () => {
    render(
      <TransactionPhotoLayout photoSrc="/api/receipt-photos/p1" photoId="p1" transactionId="t1">
        <p>form</p>
      </TransactionPhotoLayout>,
    );
    expect(screen.getByText("Also on Home Supplies")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open receipt photo" }));
    expect(screen.getByRole("dialog", { name: /receipt/i })).toBeDefined();
  });

  it("offers no viewer for a local file that has not been uploaded", () => {
    render(
      <TransactionPhotoLayout photoSrc="blob:preview" photoId={null}>
        <p>form</p>
      </TransactionPhotoLayout>,
    );
    expect(screen.queryByRole("button", { name: "Open receipt photo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open full screen" })).toBeNull();
    expect(screen.queryByText("Tap to open")).toBeNull();
  });

  it("closes the viewer before opening the form's picker on Replace", () => {
    const onReplacePhoto = vi.fn();
    render(
      <TransactionPhotoLayout photoSrc="/api/receipt-photos/p1" photoId="p1" onReplacePhoto={onReplacePhoto}>
        <p>form</p>
      </TransactionPhotoLayout>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open full screen" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(onReplacePhoto).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
