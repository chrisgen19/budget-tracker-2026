import type { TransactionSelectionItem } from "@/lib/transaction-bulk";

export interface TransactionSelectionState {
  selected: Map<string, TransactionSelectionItem>;
  scope: "manual" | "all-matching-snapshot";
  matchingCount: number | null;
}

export type TransactionSelectionAction =
  | { type: "toggle"; item: TransactionSelectionItem }
  | { type: "toggle-visible"; items: TransactionSelectionItem[] }
  | { type: "select-snapshot"; items: TransactionSelectionItem[] }
  | { type: "reconcile"; items: TransactionSelectionItem[] }
  | { type: "clear" };

export const emptyTransactionSelection = (): TransactionSelectionState => ({
  selected: new Map(),
  scope: "manual",
  matchingCount: null,
});

export function transactionSelectionReducer(
  state: TransactionSelectionState,
  action: TransactionSelectionAction,
): TransactionSelectionState {
  if (action.type === "clear") return emptyTransactionSelection();

  if (action.type === "select-snapshot") {
    return {
      selected: new Map(action.items.map((item) => [item.id, item])),
      scope: "all-matching-snapshot",
      matchingCount: action.items.length,
    };
  }

  if (action.type === "reconcile") {
    return {
      ...state,
      selected: new Map(action.items.map((item) => [item.id, item])),
    };
  }

  const selected = new Map(state.selected);
  if (action.type === "toggle") {
    if (selected.has(action.item.id)) selected.delete(action.item.id);
    else selected.set(action.item.id, action.item);
  } else {
    const visibleIds = action.items.map((item) => item.id);
    const everyVisibleSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    if (everyVisibleSelected) {
      for (const id of visibleIds) selected.delete(id);
    } else {
      for (const item of action.items) selected.set(item.id, item);
    }
  }

  return {
    selected,
    scope: state.scope,
    matchingCount: state.matchingCount,
  };
}

export function visibleSelectionState(
  selection: TransactionSelectionState,
  visibleIds: string[],
): "none" | "some" | "all" {
  const selectedCount = visibleIds.filter((id) => selection.selected.has(id)).length;
  if (selectedCount === 0) return "none";
  return selectedCount === visibleIds.length ? "all" : "some";
}

export const selectionItems = (selection: TransactionSelectionState) =>
  Array.from(selection.selected.values());
