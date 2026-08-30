import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBulkTransactionEdit } from "@/hooks/use-bulk-transaction-edit";
import type { TransactionSelectionItem } from "@/lib/transaction-bulk";
import type { TransactionWithCategory } from "@/types";

const selected = (id: string): TransactionSelectionItem => ({
  id,
  description: id,
  type: "EXPENSE",
  amount: 1,
});

const transaction = (id: string) => ({ id }) as TransactionWithCategory;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useBulkTransactionEdit", () => {
  it("ignores a stale detail response and preserves a newer selection", async () => {
    const request = deferred<TransactionWithCategory>();
    const revision = { current: 3 };
    const onLoaded = vi.fn();
    const onClearSelection = vi.fn();
    const onError = vi.fn();
    const loadTransaction = vi.fn(() => request.promise);

    const { result } = renderHook(() =>
      useBulkTransactionEdit({
        selectedItems: [selected("original")],
        selectionRevisionRef: revision,
        onLoaded,
        onClearSelection,
        onError,
        loadTransaction,
      }),
    );

    let editRequest!: Promise<void>;
    act(() => {
      editRequest = result.current.edit();
    });
    expect(result.current.pending).toBe(true);

    revision.current += 1;
    await act(async () => {
      request.resolve(transaction("original"));
      await editRequest;
    });

    expect(onLoaded).not.toHaveBeenCalled();
    expect(onClearSelection).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  it("opens and clears the unchanged selection after loading", async () => {
    const revision = { current: 7 };
    const loaded = transaction("selected");
    const onLoaded = vi.fn();
    const onClearSelection = vi.fn();

    const { result } = renderHook(() =>
      useBulkTransactionEdit({
        selectedItems: [selected("selected")],
        selectionRevisionRef: revision,
        onLoaded,
        onClearSelection,
        onError: vi.fn(),
        loadTransaction: vi.fn().mockResolvedValue(loaded),
      }),
    );

    await act(async () => {
      await result.current.edit();
    });

    expect(onLoaded).toHaveBeenCalledWith(loaded);
    expect(onClearSelection).toHaveBeenCalledOnce();
  });
});
