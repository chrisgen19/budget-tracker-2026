import { useEffect, useReducer, useRef } from "react";
import { fetchTransactionById } from "@/hooks/use-transactions";
import type { TransactionWithCategory } from "@/types";

/**
 * Where one `?highlight=` id is in its life. There is deliberately no "found" or "not found"
 * state: both end in `spent`, and what differs between them is a side effect (a modal or a
 * toast), not anything later code needs to read.
 */
type HighlightState =
  | { status: "idle" }
  | { status: "fetching"; id: string }
  | { status: "spent"; id: string };

type HighlightAction =
  | { type: "found"; id: string }
  | { type: "fetch"; id: string }
  | { type: "settled"; id: string }
  | { type: "cleared" };

const IDLE: HighlightState = { status: "idle" };

/** Every branch returns the same object when nothing changes, so a repeat dispatch renders nothing. */
const highlightReducer = (state: HighlightState, action: HighlightAction): HighlightState => {
  switch (action.type) {
    case "found":
      return state.status === "spent" && state.id === action.id
        ? state
        : { status: "spent", id: action.id };
    case "fetch":
      return state.status === "fetching" && state.id === action.id
        ? state
        : { status: "fetching", id: action.id };
    case "settled":
      // Only the request that is still wanted may finish. The effect's cleanup already stops a
      // stale reply from dispatching, so this is the reducer refusing to depend on that.
      return state.status === "fetching" && state.id === action.id
        ? { status: "spent", id: action.id }
        : state;
    case "cleared":
      return state.status === "idle" ? state : IDLE;
  }
};

/** Whether this id has already been taken on, so a re-render must not start it again. */
const isClaimed = (state: HighlightState, id: string) =>
  state.status !== "idle" && state.id === id;

interface UseHighlightedTransactionOptions {
  /** The `?highlight=` id, or null when the URL carries none. */
  highlightId: string | null;
  /** The rows the page already has. Checked first, so a row on screen costs no request. */
  loadedRows: TransactionWithCategory[];
  /** True until the list has settled. Nothing is resolved before then. */
  loading: boolean;
  onOpen: (transaction: TransactionWithCategory) => void;
  /** A lookup that failed. Called at most once per id, and the id is spent all the same. */
  onError: (error: unknown) => void;
  loadTransaction?: (id: string) => Promise<TransactionWithCategory>;
}

/**
 * Resolve a `?highlight=<id>` link to one row, exactly once.
 *
 * Bill history and the Telegram deep link both name a row this way, and it can be from any
 * month. The ledger opens on all time showing the newest page, so the loaded rows are only a
 * shortcut: when the row is not among them it is fetched by id, which works the same for both
 * layouts and hands back the date the period jump needs.
 *
 * This used to be three refs and a piece of state spread across four effects in the page, and
 * three review rounds on #289 each found a bug in the previous round's fix. The rules those bugs
 * established are what this hook exists to hold in one place:
 *
 * - **It never writes the URL.** It reports `pending`, the page's mirror waits on it, and the
 *   mirror's single write drops the parameter and carries the period jump together. A second
 *   writer raced the mirror within one commit and left a January row's list on September.
 * - **`pending` is state, not a ref.** A row already in the current month leaves the page's
 *   filters unchanged, so nothing else would re-render the mirror and the parameter would stay.
 * - **A lookup is cancelled by its own identity only.** The request lives in an effect keyed on
 *   the id being fetched and nothing else. It used to share an effect with the loaded rows, which
 *   change on their own as pages arrive, and a cleanup there dropped the reply for good.
 * - **Dropping the parameter abandons the lookup.** The nav item for this page is a plain link to
 *   bare `/transactions` that renders as active, so clicking it mid-lookup does not remount; a
 *   late reply must not then open a row the user has just left.
 * - **A failed lookup says so, and is still spent**, so it neither fails silently nor retries on
 *   every render.
 *
 * Once the parameter goes the id is released, so the same row can be linked to again without a
 * remount. No caller does that today, since both producers sit on another route, but the link is
 * a documented route contract (`telegram/app-link.ts`) and should hold for any caller.
 */
export function useHighlightedTransaction({
  highlightId,
  loadedRows,
  loading,
  onOpen,
  onError,
  loadTransaction = fetchTransactionById,
}: UseHighlightedTransactionOptions) {
  const [state, dispatch] = useReducer(highlightReducer, IDLE);

  // The latest callbacks, read when a reply lands. As dependencies they would restart the
  // lookup every time a caller passed a fresh closure.
  const handlers = useRef({ onOpen, onError, loadTransaction });
  useEffect(() => {
    handlers.current = { onOpen, onError, loadTransaction };
  });

  useEffect(() => {
    if (!highlightId) {
      dispatch({ type: "cleared" });
      return;
    }
    if (loading || isClaimed(state, highlightId)) return;

    const loaded = loadedRows.find((row) => row.id === highlightId);
    if (loaded) {
      handlers.current.onOpen(loaded);
      dispatch({ type: "found", id: highlightId });
    } else {
      dispatch({ type: "fetch", id: highlightId });
    }
  }, [highlightId, loadedRows, loading, state]);

  const fetchingId = state.status === "fetching" ? state.id : null;
  useEffect(() => {
    if (!fetchingId) return;
    let wanted = true;
    handlers.current
      .loadTransaction(fetchingId)
      .then((transaction) => {
        if (wanted) handlers.current.onOpen(transaction);
      })
      .catch((error: unknown) => {
        if (wanted) handlers.current.onError(error);
      })
      .finally(() => {
        if (wanted) dispatch({ type: "settled", id: fetchingId });
      });
    // Runs only when `fetchingId` changes: a newer id, the parameter being dropped, or unmount.
    // Each of those is exactly a reply nobody wants any more.
    return () => {
      wanted = false;
    };
  }, [fetchingId]);

  const spent = state.status === "spent" && state.id === highlightId;
  return { pending: Boolean(highlightId) && !spent };
}
