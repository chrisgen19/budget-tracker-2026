import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { TransactionInput } from "@/lib/validations";
import type { TransactionWithCategory } from "@/types";

const mocks = vi.hoisted(() => ({
  photosEnabled: true,
  upload: vi.fn(),
  compress: vi.fn(async (file: File) => file),
  showToast: vi.fn(),
}));

vi.mock("@/components/user-provider", () => ({
  useUser: () => ({
    user: {
      currency: "PHP",
      timezoneOffset: -480,
      transactionAmountAutofocus: false,
      get receiptPhotosEnabled() {
        return mocks.photosEnabled;
      },
    },
  }),
}));

vi.mock("@/hooks/use-categories", () => {
  // Built once, for the stable identity the form's category effects depend on.
  const byType = {
    EXPENSE: [{ id: "food", name: "Food", type: "EXPENSE", icon: "utensils", color: "#000000" }],
    INCOME: [{ id: "salary", name: "Salary", type: "INCOME", icon: "wallet", color: "#000000" }],
  };
  const quickPreferences = { quickExpenseCategories: ["food"], quickIncomeCategories: [] };
  return {
    useCategoriesQuery: (type?: "INCOME" | "EXPENSE") => ({
      data: type ? byType[type] : [...byType.EXPENSE, ...byType.INCOME],
      isLoading: false,
    }),
    useQuickPreferencesQuery: () => ({ data: quickPreferences }),
  };
});

vi.mock("@/hooks/use-labels", () => {
  const data: unknown[] = [];
  return { useLabelsQuery: () => ({ data }) };
});
vi.mock("@/hooks/use-scheduled-label", () => ({
  useScheduledLabel: () => ({ scheduledLabelId: null }),
}));
vi.mock("@/components/transactions/label-picker", () => ({ LabelPicker: () => null }));
vi.mock("@/hooks/use-receipt-photos", () => ({
  receiptPhotoUrl: (id: string) => `/api/receipt-photos/${id}`,
  uploadReceiptPhoto: mocks.upload,
  useReceiptPhotoInfo: () => ({ data: undefined, isLoading: true, isError: false }),
}));
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  compressImage: mocks.compress,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));

const FAILED_UPLOAD_TOAST = "Saved. The photo didn't upload: attach it from the transaction.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterAll(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});
beforeEach(() => {
  mocks.photosEnabled = true;
  mocks.upload.mockReset();
  mocks.compress.mockClear();
  mocks.showToast.mockClear();
});

const submit = () =>
  fireEvent.click(document.querySelector('button[type="submit"]') as HTMLButtonElement);
const chooseFile = () => {
  const file = new File(["jpeg"], "receipt.jpg", { type: "image/jpeg" });
  fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [file] },
  });
  return file;
};

const renderForm = (
  props: Partial<Parameters<typeof TransactionForm>[0]> = {},
  onSubmit = vi.fn((_data: TransactionInput) => Promise.resolve()),
) => {
  render(
    <TransactionForm
      initialData={{ amount: 250, categoryId: "food" }}
      allowReceiptPhoto
      onSubmit={onSubmit}
      onCancel={() => {}}
      {...props}
    />,
  );
  return onSubmit;
};

const withPhoto = {
  id: "tx-1",
  amount: 190.95,
  description: "SM Supermarket",
  type: "EXPENSE",
  date: new Date("2026-11-26T03:59:00.000Z"),
  categoryId: "food",
  receiptPhotoId: "photo-1",
  category: { id: "food", name: "Food" },
  labels: [],
} as unknown as TransactionWithCategory;

describe("TransactionForm receipt photo", () => {
  it("renders nothing photo-related when receipt photos are disabled", () => {
    mocks.photosEnabled = false;
    renderForm({ transaction: withPhoto, initialData: undefined });

    expect(screen.queryByRole("button", { name: "Attach photo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  // The scan review and Pay & Edit reuse this form and have no photo flow of their own yet.
  it("renders nothing photo-related unless the caller opts in", () => {
    renderForm({ allowReceiptPhoto: false });

    expect(screen.queryByRole("button", { name: "Attach photo" })).toBeNull();
  });

  it("does not upload on choose; submitting uploads once with a UUID key, then submits the id", async () => {
    mocks.upload.mockResolvedValue({ id: "photo-9" });
    const onPresence = vi.fn();
    const onSubmit = renderForm({ onPhotoPresenceChange: onPresence });

    const file = chooseFile();
    await waitFor(() => expect(onPresence).toHaveBeenLastCalledWith(true));
    expect(mocks.upload).not.toHaveBeenCalled();

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(mocks.compress).toHaveBeenCalledWith(file);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.upload.mock.calls[0][1]).toMatch(UUID);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ receiptPhotoId: "photo-9" });
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("still saves without the photo when the upload fails, and says so once", async () => {
    mocks.upload.mockRejectedValue(new Error("upload refused"));
    const onSubmit = renderForm();

    chooseFile();
    submit();

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("receiptPhotoId");
    expect(mocks.showToast.mock.calls[0][0]).toBe(FAILED_UPLOAD_TOAST);
  });

  it("does not claim Saved when the save itself fails, and reuses the photo key on retry", async () => {
    // A caller's refusal escapes `handleSubmit` exactly as it did before photos, and React drops
    // the promise, so it surfaces as an unhandled rejection. Collected here so only this test's
    // two expected refusals are excused, and asserted so an unrelated one still fails the run.
    const vitestListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const escaped: unknown[] = [];
    process.on("unhandledRejection", (reason) => escaped.push(reason));
    try {
      mocks.upload.mockRejectedValue(new Error("upload refused"));
      const onSubmit = vi.fn((_data: TransactionInput) => Promise.reject(new Error("save failed")));
      renderForm({}, onSubmit);

      chooseFile();
      submit();
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      submit();
      await waitFor(() => expect(escaped).toHaveLength(2));

      expect(onSubmit).toHaveBeenCalledTimes(2);
      expect(escaped.every((e) => e instanceof Error && e.message === "save failed")).toBe(true);
      expect(mocks.showToast).not.toHaveBeenCalled();
      expect(mocks.upload).toHaveBeenCalledTimes(2);
      expect(mocks.upload.mock.calls[1][1]).toBe(mocks.upload.mock.calls[0][1]);
    } finally {
      process.removeAllListeners("unhandledRejection");
      for (const listener of vitestListeners) process.on("unhandledRejection", listener);
    }
  });

  it("shows the saved photo and sends receiptPhotoId: null when it is removed", async () => {
    const onSubmit = renderForm({ transaction: withPhoto, initialData: undefined });

    expect(document.querySelector('img[src="/api/receipt-photos/photo-1"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.getByRole("button", { name: "Attach photo" })).toBeTruthy();
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ receiptPhotoId: null });
  });

  // The user removed the stored photo; a failed upload of its successor must not bring it back.
  it("still unlinks a removed photo when the new one attached after it fails to upload", async () => {
    mocks.upload.mockRejectedValue(new Error("upload refused"));
    const onSubmit = renderForm({ transaction: withPhoto, initialData: undefined });

    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    chooseFile();
    submit();

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ receiptPhotoId: null });
    expect(mocks.showToast.mock.calls[0][0]).toBe(FAILED_UPLOAD_TOAST);
  });

  it("keeps the stored photo when a plain Replace fails to upload", async () => {
    mocks.upload.mockRejectedValue(new Error("upload refused"));
    const onSubmit = renderForm({ transaction: withPhoto, initialData: undefined });

    chooseFile();
    submit();

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("receiptPhotoId");
  });

  it("omits receiptPhotoId from an untouched form", async () => {
    const onSubmit = renderForm({ transaction: withPhoto, initialData: undefined });

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("receiptPhotoId");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
