import { describe, expect, it } from "vitest";
import {
  emptyTransactionSelection,
  selectionItems,
  transactionSelectionReducer,
  visibleSelectionState,
} from "@/lib/transaction-selection";
import type { TransactionSelectionItem } from "@/lib/transaction-bulk";

const item = (id: string): TransactionSelectionItem => ({
  id,
  description: id,
  type: "EXPENSE",
  amount: 1,
});
describe("transactionSelectionReducer", () => {
  it("toggles one transaction without affecting another page", () => {
    let state = transactionSelectionReducer(emptyTransactionSelection(), {
      type: "toggle",
      item: item("page-1"),
    });
    state = transactionSelectionReducer(state, { type: "toggle", item: item("page-2") });
    expect(selectionItems(state).map(({ id }) => id)).toEqual(["page-1", "page-2"]);
  });

  it("selects visible rows by union and deselects them by difference", () => {
    let state = transactionSelectionReducer(emptyTransactionSelection(), {
      type: "toggle",
      item: item("hidden"),
    });
    state = transactionSelectionReducer(state, {
      type: "toggle-visible",
      items: [item("visible-1"), item("visible-2")],
    });
    expect(selectionItems(state).map(({ id }) => id)).toEqual([
      "hidden",
      "visible-1",
      "visible-2",
    ]);

    state = transactionSelectionReducer(state, {
      type: "toggle-visible",
      items: [item("visible-1"), item("visible-2")],
    });
    expect(selectionItems(state).map(({ id }) => id)).toEqual(["hidden"]);
  });

  it("materializes an all-matching snapshot and supports exclusions", () => {
    let state = transactionSelectionReducer(emptyTransactionSelection(), {
      type: "select-snapshot",
      items: [item("a"), item("b"), item("c")],
    });
    expect(state.scope).toBe("all-matching-snapshot");
    expect(state.matchingCount).toBe(3);

    state = transactionSelectionReducer(state, { type: "toggle", item: item("b") });
    expect(selectionItems(state).map(({ id }) => id)).toEqual(["a", "c"]);
    expect(state.matchingCount).toBe(3);
  });

  it("reports the master checkbox state", () => {
    let state = emptyTransactionSelection();
    expect(visibleSelectionState(state, ["a", "b"])).toBe("none");
    state = transactionSelectionReducer(state, { type: "toggle", item: item("a") });
    expect(visibleSelectionState(state, ["a", "b"])).toBe("some");
    state = transactionSelectionReducer(state, { type: "toggle", item: item("b") });
    expect(visibleSelectionState(state, ["a", "b"])).toBe("all");
  });

  it("clears selection on request", () => {
    const selected = transactionSelectionReducer(emptyTransactionSelection(), {
      type: "toggle",
      item: item("a"),
    });
    expect(transactionSelectionReducer(selected, { type: "clear" })).toEqual(
      emptyTransactionSelection(),
    );
  });
});
