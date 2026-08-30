import { useCallback, useRef, useState } from "react";
import { fetchTransactionById } from "@/hooks/use-transactions";
import type { TransactionSelectionItem } from "@/lib/transaction-bulk";
import type { TransactionWithCategory } from "@/types";

interface UseBulkTransactionEditOptions {
  selectedItems: TransactionSelectionItem[];
  selectionRevisionRef: { current: number };
  onLoaded: (transaction: TransactionWithCategory) => void;
  onClearSelection: () => void;
  onError: (error: unknown) => void;
  loadTransaction?: (id: string) => Promise<TransactionWithCategory>;
}

/** Load the one selected transaction without letting a stale response replace newer selection. */
export function useBulkTransactionEdit({
  selectedItems,
  selectionRevisionRef,
  onLoaded,
  onClearSelection,
  onError,
  loadTransaction = fetchTransactionById,
}: UseBulkTransactionEditOptions) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  const edit = useCallback(async () => {
    if (selectedItems.length !== 1 || pendingRef.current) return;
    const id = selectedItems[0]?.id;
    if (!id) return;

    const requestedRevision = selectionRevisionRef.current;
    pendingRef.current = true;
    setPending(true);

    try {
      const transaction = await loadTransaction(id);
      if (selectionRevisionRef.current !== requestedRevision) return;
      onLoaded(transaction);
      onClearSelection();
    } catch (error) {
      if (selectionRevisionRef.current === requestedRevision) onError(error);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [loadTransaction, onClearSelection, onError, onLoaded, selectedItems, selectionRevisionRef]);

  return { edit, pending };
}
