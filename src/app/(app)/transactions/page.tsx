"use client";

import { useEffect, useMemo, useReducer, useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ArrowLeftRight,
  AlertTriangle,
  Loader2,
  ScanLine,
} from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { formatCurrency, cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { DropdownButton, type DropdownItem } from "@/components/ui/dropdown-button";
import { TransactionForm } from "@/components/transactions/transaction-form";
import {
  TransactionFiltersBar,
  type TransactionFilters,
} from "@/components/transactions/transaction-filters";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { useScan } from "@/components/scan-provider";
import { ActionFab } from "@/components/ui/action-fab";
import { TransactionLabelPills } from "@/components/transactions/transaction-label-pills";
import { TransactionRowBadges } from "@/components/transactions/transaction-row-badges";
import { TransactionSelectionCheckbox } from "@/components/transactions/transaction-selection-checkbox";
import { TransactionBulkActionBar } from "@/components/transactions/transaction-bulk-action-bar";
import {
  TransactionBulkCategoryDialog,
  TransactionBulkLabelsDialog,
} from "@/components/transactions/transaction-bulk-dialogs";
import { useToast } from "@/components/ui/toast";
import {
  fetchTransactionById,
  fetchTransactionsPage,
  queryKeys,
  useTransactionsQuery,
  useTransactionsInfiniteQuery,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useBulkDeleteTransactions,
  useBulkUpdateTransactions,
  useExportTransactions,
  useTransactionSelectionSnapshot,
  useRemoveTransactionLabel,
} from "@/hooks/use-transactions";
import { useBulkTransactionEdit } from "@/hooks/use-bulk-transaction-edit";
import type { TransactionInput } from "@/lib/validations";
import { groupByDate, formatTime } from "@/lib/transaction-helpers";
import { accountDateKey } from "@/lib/account-time";
import { getCurrentMonth, monthRange } from "@/lib/analytics-period";
import { filterSearchParams, parseFilterParams } from "@/lib/transaction-period-url";
import { analyticsReturnTarget } from "@/lib/analytics-url";
import { ReturnBar } from "@/components/transactions/return-bar";
import {
  emptyTransactionSelection,
  selectionItems,
  transactionSelectionReducer,
  visibleSelectionState,
} from "@/lib/transaction-selection";
import type { TransactionSelectionAction } from "@/lib/transaction-selection";
import type { TransactionSelectionItem } from "@/lib/transaction-bulk";
import type { TransactionWithCategory } from "@/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** The month key a transaction falls in, on the account's wall clock. */
const monthOf = (date: Date | string, timezoneOffset: number) => {
  const day = accountDateKey(date, timezoneOffset);
  return monthRange(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1);
};

/** "all", "2026-09" for a whole month, else "2026-09-01_2026-09-14". */
const exportFileSuffix = (filters: TransactionFilters) => {
  if (filters.period === "all" || !filters.from || !filters.to) return "all";
  const month = monthRange(Number(filters.from.slice(0, 4)), Number(filters.from.slice(5, 7)) - 1);
  if (filters.from === month.from && filters.to === month.to) return filters.from.slice(0, 7);
  return `${filters.from}_${filters.to}`;
};

/** Build initial filters with current month */
const createInitialFilters = (timezoneOffset: number): TransactionFilters => {
  return {
    search: "",
    type: "ALL",
    period: "monthly",
    ...getCurrentMonth(timezoneOffset),
    categoryId: null,
    labelId: null,
    createdVia: "ALL",
    amountMin: null,
    amountMax: null,
    sortBy: "date",
    sortDir: "desc",
  };
};

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function TransactionsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const highlightId = searchParams.get("highlight");

  const { hideAmounts } = usePrivacy();
  const { user } = useUser();
  const { showToast } = useToast();
  const { canScan, openScan, scanLimitReached, scansRemaining, hasLimit } = useScan();
  const currency = user.currency;
  const isInfinite = user.transactionLayout === "infinite";
  const [filters, setFilters] = useState<TransactionFilters>(() => {
    const initial = createInitialFilters(user.timezoneOffset);
    // If highlighting a transaction, drop the window so we search all data
    if (searchParams.get("highlight")) {
      return { ...initial, period: "all", from: null, to: null };
    }
    const { ret: _ret, ...incoming } = parseFilterParams(searchParams, user.timezoneOffset);
    return { ...initial, ...incoming };
  });
  const [page, setPage] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);

  // Selection
  const [selection, dispatchSelection] = useReducer(
    transactionSelectionReducer,
    undefined,
    emptyTransactionSelection,
  );
  const selectionRevisionRef = useRef(0);
  const selectionContextKey = JSON.stringify([filters, user.timezoneOffset]);
  const selectionContextKeyRef = useRef(selectionContextKey);
  const dispatchSelectionChange = useCallback((action: TransactionSelectionAction) => {
    selectionRevisionRef.current += 1;
    dispatchSelection(action);
  }, []);
  const selectedItems = useMemo(() => selectionItems(selection), [selection]);
  const selectedIds = useMemo(
    () => new Set(selectedItems.map((item) => item.id)),
    [selectedItems],
  );
  const selectedTypes = useMemo(
    () => new Set(selectedItems.map((item) => item.type)),
    [selectedItems],
  );
  const selectedCountRef = useRef(0);
  const [selectionAnnouncement, setSelectionAnnouncement] = useState("");

  useEffect(() => {
    selectionContextKeyRef.current = selectionContextKey;
  }, [selectionContextKey]);

  useEffect(() => {
    selectedCountRef.current = selectedItems.length;
  }, [selectedItems.length]);

  // Modal states
  const [showForm, setShowForm] = useState(false);
  const [editingTransaction, setEditingTransaction] =
    useState<TransactionWithCategory | null>(null);
  const [deletingTransaction, setDeletingTransaction] =
    useState<TransactionWithCategory | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showBulkCategory, setShowBulkCategory] = useState(false);
  const [showBulkLabels, setShowBulkLabels] = useState(false);
  const scrollTargetRef = useRef<string | null>(null);
  const highlightTimeoutRef = useRef<number | undefined>(undefined);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);

  /* ---- TanStack Query hooks ---- */

  const infiniteQuery = useTransactionsInfiniteQuery(filters, user.timezoneOffset);
  const paginatedQuery = useTransactionsQuery(filters, page, user.timezoneOffset);

  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();
  const bulkDeleteMutation = useBulkDeleteTransactions();
  const bulkUpdateMutation = useBulkUpdateTransactions();
  const exportMutation = useExportTransactions();
  const selectionSnapshotMutation = useTransactionSelectionSnapshot();
  const removeLabelMutation = useRemoveTransactionLabel();

  // Reset page & selection when filters change
  useEffect(() => {
    setPage(1);
    if (selectedCountRef.current > 0) {
      setSelectionAnnouncement("Transaction selection cleared because the filters changed");
    }
    dispatchSelectionChange({ type: "clear" });
  }, [dispatchSelectionChange, filters]);

  useEffect(() => {
    if (selectedItems.length > 0) {
      setSelectionAnnouncement(
        `${selectedItems.length} transaction${selectedItems.length === 1 ? "" : "s"} selected`,
      );
    }
  }, [selectedItems.length]);

  useEffect(() => {
    if (selectedItems.length === 0) return;
    const clearOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector('[role="dialog"]') &&
        !document.querySelector('[role="menu"]')
      ) {
        dispatchSelectionChange({ type: "clear" });
        setSelectionAnnouncement("Transaction selection cleared");
        requestAnimationFrame(() => pageHeadingRef.current?.focus());
      }
    };
    document.addEventListener("keydown", clearOnEscape);
    return () => document.removeEventListener("keydown", clearOnEscape);
  }, [dispatchSelectionChange, selectedItems.length]);

  // Destructure for stable references in useEffect deps
  const {
    hasNextPage,
    isFetchingNextPage,
    isLoading: infiniteIsLoading,
    fetchNextPage,
  } = infiniteQuery;

  // Infinite scroll: IntersectionObserver on sentinel
  useEffect(() => {
    if (!isInfinite) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          entry.isIntersecting &&
          hasNextPage &&
          !isFetchingNextPage &&
          !infiniteIsLoading
        ) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isInfinite, hasNextPage, isFetchingNextPage, infiniteIsLoading, fetchNextPage]);

  // Highlight a transaction from query param (e.g. from bill history link)
  // Two guards with different jobs. The ref stops re-entry inside a single commit,
  // since `sourceTransactions` changes as pages arrive and a second pass would fire
  // a second lookup for the same id. The state is what the mirror below gates on,
  // and it has to be state: a highlighted row already in the current month leaves
  // `filterQuery` unchanged, so nothing else would re-render the mirror and the
  // parameter would sit in the URL forever.
  const highlightHandledRef = useRef<string | null>(null);
  const [spentHighlightId, setSpentHighlightId] = useState<string | null>(null);
  /** The id a by-id lookup is in flight for, so a superseded response is ignored. */
  const highlightLookupRef = useRef<string | null>(null);

  // The address bar mirrors the filters, so a window or a drill-down survives a
  // refresh and can be linked to. Deriving the string first keeps the effect keyed
  // on its value rather than on a fresh filters object every render.
  //
  // It mirrors the narrowings, not just the period, and that is load-bearing: an
  // analytics drill-down arrives carrying a category, and a mirror that wrote back
  // only the period would drop it from the URL — at which point the reader below,
  // seeing the URL change, would take the category off the filters too and widen
  // the list the user had just narrowed.
  // Deliberately not part of `filters`: it narrows nothing. That object is posted
  // verbatim to /api/transactions/selection and keys the React Query cache, so a
  // navigation breadcrumb in it would split the cache per entry point and travel to
  // an endpoint with no use for it. It is mirrored into the URL alongside the
  // filters, though, or the first filter edit would drop the way back.
  const [returnParam, setReturnParam] = useState<string | null>(
    () => parseFilterParams(new URLSearchParams(searchParams.toString()), user.timezoneOffset).ret,
  );
  // The href is built from a literal path, so a crafted `ret` can only produce a
  // different analytics view, never an off-site link. The label comes back with it
  // so the two cannot describe different periods.
  const returnTarget = analyticsReturnTarget(returnParam, user.timezoneOffset);

  const filterQuery = filterSearchParams({ ...filters, ret: returnParam });
  const appliedQueryRef = useRef(searchParams.toString());
  useEffect(() => {
    // While a ?highlight= is still being resolved, leave the URL alone. Writing
    // here would drop the parameter before the row has been found and opened,
    // and the lookup would silently do nothing. Once the lookup is done it marks
    // the id spent and this effect takes over — it is the only writer, so the
    // parameter goes away and the period it jumped to lands in the same write.
    if (highlightId && spentHighlightId !== highlightId) return;
    // Claim it first: this write is the page describing itself, not a navigation
    // asking it to change, so the reader below must not treat it as one. Without
    // this the advanced filters — which are deliberately not in the URL — would be
    // reset by the page's own mirror on every edit.
    appliedQueryRef.current = filterQuery;
    router.replace(`/transactions?${filterQuery}`, { scroll: false });
  }, [highlightId, spentHighlightId, filterQuery, router]);

  // The other direction: a URL this page did not write imposes its filters. That
  // is an analytics drill-down, a pasted link, or the back button — including the
  // nav item for this page, a plain link to /transactions that renders as *active*
  // while a drill-down is on screen, so clicking it is how someone asks for the
  // unfiltered list back. The route does not change, so the page is never
  // unmounted to reset itself.
  const queryString = searchParams.toString();
  // Counts the rewrites, so the toolbar can tell one from an ordinary render. A
  // URL with no search still has to clear a half-typed one, and "" before and ""
  // after is invisible to anything watching the committed value.
  const [filtersRevision, setFiltersRevision] = useState(0);
  useEffect(() => {
    if (appliedQueryRef.current === queryString) return;
    appliedQueryRef.current = queryString;
    const params = new URLSearchParams(queryString);
    if (params.get("highlight")) return;
    const { ret, ...incoming } = parseFilterParams(params, user.timezoneOffset);
    setFilters((current) => ({ ...current, ...incoming }));
    setReturnParam(ret);
    setFiltersRevision((revision) => revision + 1);
  }, [queryString, user.timezoneOffset]);


  const openHighlighted = useCallback(
    (tx: TransactionWithCategory) => {
      setEditingTransaction(tx);
      // Leave the all-time lookup on the transaction's own account-local month so the
      // period arrows keep their normal meaning after the edit modal closes. For a row
      // that was not in the loaded set, this is also what brings it into view.
      const month = monthOf(tx.date, user.timezoneOffset);
      setFilters((current) =>
        current.period === "monthly" && current.from === month.from
          ? current
          : { ...current, period: "monthly", ...month }
      );
      scrollTargetRef.current = tx.id;
    },
    [user.timezoneOffset],
  );

  /**
   * Hand the URL back to the mirror.
   *
   * Replacing with a bare `/transactions` here instead looked right and was not: the
   * mirror would then write the period, clobbering the claim on `appliedQueryRef`
   * within the same commit, and the sync effect would read the empty query as a
   * request for default filters — so a January row opened its modal and left the
   * list on September. One writer removes the race rather than sequencing it.
   */
  const consumeHighlight = useCallback((id: string) => setSpentHighlightId(id), []);

  const locateTransactionPage = useCallback(
    async (transactionId: string) => {
      if (isInfinite) return null;

      let nextPage = 1;
      let totalPagesToCheck = 1;

      try {
        while (nextPage <= totalPagesToCheck) {
          const data = await queryClient.fetchQuery({
            queryKey: queryKeys.transactions.list(filters, nextPage, user.timezoneOffset),
            queryFn: () => fetchTransactionsPage(filters, nextPage, user.timezoneOffset),
          });

          if (data.transactions.some((tx) => tx.id === transactionId)) {
            return nextPage;
          }

          totalPagesToCheck = data.pagination.totalPages;
          nextPage += 1;
        }
      } catch {
        return null;
      }

      return null;
    },
    [filters, isInfinite, queryClient, user.timezoneOffset],
  );

  /* ---- Derived data ---- */

  const loading = isInfinite ? infiniteIsLoading : paginatedQuery.isLoading;
  const transactionsError = isInfinite ? infiniteQuery.isError : paginatedQuery.isError;
  const retryTransactions = isInfinite ? infiniteQuery.refetch : paginatedQuery.refetch;
  const loadingMore = isFetchingNextPage;
  const hasMore = hasNextPage ?? false;

  // Flatten infinite pages into a single array, deduplicating by id.
  // Offset-based pagination can produce duplicates when new transactions are
  // inserted between page fetches (the offset shifts, causing a boundary item
  // to appear on both the current and next page).
  const allInfiniteTransactions = useMemo(() => {
    const all = infiniteQuery.data?.pages.flatMap((p) => p.transactions) ?? [];
    const seen = new Set<string>();
    return all.filter((tx) => {
      if (seen.has(tx.id)) return false;
      seen.add(tx.id);
      return true;
    });
  }, [infiniteQuery.data?.pages]);
  const sourceTransactions = useMemo(
    () => isInfinite ? allInfiniteTransactions : (paginatedQuery.data?.transactions ?? []),
    [isInfinite, allInfiniteTransactions, paginatedQuery.data?.transactions],
  );

  // Release the claim once the parameter is gone, so the same row can be linked to
  // again. Not reachable today — both producers (bill history and the Telegram deep
  // link) sit on another route, so arriving here always mounts this page fresh and
  // the refs start empty. It is cheap insurance on a documented route contract that
  // external callers use: an in-page link to `?highlight=` added later would
  // otherwise open the modal once and silently do nothing on every repeat.
  useEffect(() => {
    if (highlightId) return;
    // The lookup ref goes too, and that one is not housekeeping. A request can still
    // be in flight here: the nav item for this page is a plain link to bare
    // /transactions and renders as active, so clicking it during a slow lookup drops
    // the parameter without remounting. Leaving the ref set let the reply pass its own
    // staleness check and open a modal for a row the user had just navigated away
    // from, jumping the period to that row's month as well — the opposite of the
    // unfiltered list they asked for.
    highlightLookupRef.current = null;
    highlightHandledRef.current = null;
    setSpentHighlightId((current) => (current === null ? current : null));
  }, [highlightId]);

  // Auto-open a highlighted transaction from the query param.
  //
  // The loaded rows are only a shortcut. A link from bill history or Telegram can
  // name a row from any month, and the ledger opens on all time showing the newest
  // page — so searching that page alone meant an older row produced no modal, no
  // message, and nothing to suggest anything had been meant to happen. Falling back
  // to a fetch by id works the same for both layouts and hands back the row's date,
  // which is what the period jump needs anyway.
  //
  // Waiting for the list to settle keeps the common case request-free: a row linked
  // from a recent bill is usually on screen already.
  useEffect(() => {
    if (!highlightId || highlightHandledRef.current === highlightId || loading) return;
    // Claimed before the await, not after. `sourceTransactions` changes as pages
    // arrive, and re-entering here would fire a second lookup for the same id.
    highlightHandledRef.current = highlightId;

    const loaded = sourceTransactions.find((t) => t.id === highlightId);
    if (loaded) {
      openHighlighted(loaded);
      consumeHighlight(highlightId);
      return;
    }

    // Deliberately no cleanup function. A cleanup would cancel this lookup whenever
    // any dependency changed — and `sourceTransactions` changes on its own, as the
    // infinite layout appends a page or a refetch returns a fresh array. That killed
    // the response while `highlightHandledRef` still held the id, so the effect would
    // not retry: no modal, and `?highlight=` stuck in the URL. Exactly the silent
    // failure this whole change is about, reintroduced one layer in.
    //
    // Staleness is tracked by which id is being looked up instead, which is the thing
    // that actually invalidates a response. A later highlight overwrites the ref and
    // the earlier reply is dropped; an array growing underneath it is irrelevant.
    highlightLookupRef.current = highlightId;
    const isCurrent = () => highlightLookupRef.current === highlightId;

    fetchTransactionById(highlightId)
      .then((tx) => {
        if (isCurrent()) openHighlighted(tx);
      })
      .catch((error: unknown) => {
        // A link that resolves to nothing has to say so. Silence reads as the app
        // ignoring the tap, and the two causes send you to look at different things:
        // the row may have been deleted since the link was made, or the request may
        // never have left the device.
        if (!isCurrent()) return;
        showToast(
          error instanceof Error ? error.message : "Could not open that transaction",
          "error",
        );
      })
      .finally(() => {
        if (!isCurrent()) return;
        highlightLookupRef.current = null;
        consumeHighlight(highlightId);
      });
  }, [
    highlightId,
    loading,
    sourceTransactions,
    openHighlighted,
    consumeHighlight,
    showToast,
  ]);

  // Scroll to a newly created/updated transaction once the rendered list
  // actually includes it. The target lives in a ref so clearing it does not
  // trigger a cleanup cycle that would cancel the highlight timeout.
  useEffect(() => {
    const targetId = scrollTargetRef.current;
    if (!targetId) return;

    const row = document.querySelector<HTMLElement>(`[data-transaction-id="${targetId}"]`);
    if (!row) return;

    scrollTargetRef.current = null;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedRowId(targetId);

    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedRowId((current) => (current === targetId ? null : current));
    }, 1600);
  }, [sourceTransactions]);

  // Cleanup highlight timeout on unmount
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  // Pagination metadata
  const paginationData = isInfinite
    ? infiniteQuery.data?.pages[0]?.pagination
    : paginatedQuery.data?.pagination;
  const totalCount = paginationData?.total ?? null;
  const totalPages = paginationData?.totalPages ?? 1;

  useEffect(() => {
    if (!isInfinite && page > Math.max(1, totalPages)) {
      setPage(Math.max(1, totalPages));
    }
  }, [isInfinite, page, totalPages]);

  const dateGroups = groupByDate(sourceTransactions, user.timezoneOffset);
  const visibleSelectionItems = useMemo<TransactionSelectionItem[]>(
    () =>
      sourceTransactions.map(({ id, description, type, amount }) => ({
        id,
        description,
        type,
        amount,
      })),
    [sourceTransactions],
  );
  const visibleIds = useMemo(
    () => visibleSelectionItems.map((item) => item.id),
    [visibleSelectionItems],
  );
  const masterSelectionState = visibleSelectionState(selection, visibleIds);

  /* ---- Selection handlers ---- */

  const toggleSelection = (transaction: TransactionSelectionItem) =>
    dispatchSelectionChange({ type: "toggle", item: transaction });

  const toggleSelectAll = () => {
    if (visibleSelectionItems.length === 0) return;
    dispatchSelectionChange({ type: "toggle-visible", items: visibleSelectionItems });
  };

  const clearSelection = (restoreFocus = false) => {
    dispatchSelectionChange({ type: "clear" });
    setSelectionAnnouncement("Transaction selection cleared");
    if (restoreFocus) requestAnimationFrame(() => pageHeadingRef.current?.focus());
  };

  const { edit: handleBulkEdit, pending: bulkEditPending } = useBulkTransactionEdit({
    selectedItems,
    selectionRevisionRef,
    onLoaded: setEditingTransaction,
    onClearSelection: clearSelection,
    onError: (error) =>
      showToast(error instanceof Error ? error.message : "Failed to load transaction", "error"),
  });

  const handleSelectAllMatching = async () => {
    const requestedRevision = selectionRevisionRef.current;
    const requestedFilters = selectionContextKey;
    try {
      const result = await selectionSnapshotMutation.mutateAsync({
        filters,
        timezoneOffset: user.timezoneOffset,
      });
      if (
        selectionRevisionRef.current !== requestedRevision ||
        selectionContextKeyRef.current !== requestedFilters
      ) {
        return;
      }
      dispatchSelectionChange({ type: "select-snapshot", items: result.transactions });
      setSelectionAnnouncement(`All ${result.count} matching transactions selected`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not select all transactions", "error");
    }
  };

  /* ---- CRUD handlers ---- */

  const handleCreate = async (input: TransactionInput) => {
    const createdTx = await createMutation.mutateAsync(input);
    setShowForm(false);
    scrollTargetRef.current = createdTx.id;

    if (!isInfinite) {
      const targetPage = await locateTransactionPage(createdTx.id);
      if (targetPage !== null) {
        setPage(targetPage);
      } else if (scrollTargetRef.current === createdTx.id) {
        scrollTargetRef.current = null;
      }
    }
  };

  const handleUpdate = async (input: TransactionInput) => {
    if (!editingTransaction) return;
    const targetId = editingTransaction.id;
    scrollTargetRef.current = targetId;

    try {
      await updateMutation.mutateAsync({ id: targetId, input });
      setEditingTransaction(null);

      if (!isInfinite) {
        const targetPage = await locateTransactionPage(targetId);
        if (targetPage !== null) {
          setPage(targetPage);
        } else if (scrollTargetRef.current === targetId) {
          scrollTargetRef.current = null;
        }
      }
    } catch (error) {
      if (scrollTargetRef.current === targetId) scrollTargetRef.current = null;
      throw error;
    }
  };

  const handleDelete = async () => {
    if (!deletingTransaction) return;
    try {
      await deleteMutation.mutateAsync(deletingTransaction.id);
      setDeletingTransaction(null);
      showToast("Transaction deleted");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to delete transaction", "error");
    }
  };

  const handleBulkDelete = async () => {
    try {
      const result = await bulkDeleteMutation.mutateAsync(Array.from(selectedIds));
      setShowBulkDelete(false);
      dispatchSelectionChange({ type: "clear" });
      const label = `${result.deleted} transaction${result.deleted === 1 ? "" : "s"} deleted`;
      setSelectionAnnouncement(label);
      showToast(label);
      requestAnimationFrame(() => pageHeadingRef.current?.focus());
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to delete transactions", "error");
    }
  };

  const handleExport = async () => {
    if (selectedIds.size === 0) return;
    try {
      const result = await exportMutation.mutateAsync({
        ids: Array.from(selectedIds),
        timezoneOffset: user.timezoneOffset,
      });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `transactions-${exportFileSuffix(filters)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast(`${result.count} transaction${result.count === 1 ? "" : "s"} exported`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to export transactions", "error");
    }
  };

  const handleBulkCategory = async (categoryId: string) => {
    try {
      const result = await bulkUpdateMutation.mutateAsync({
        ids: Array.from(selectedIds),
        action: "category",
        categoryId,
      });
      setShowBulkCategory(false);
      clearSelection(true);
      // `updated` counts the rows whose category actually moved, not the rows selected, so
      // recategorising a selection that is already in that category reports nothing rather than
      // claiming an edit the server deliberately did not record. Same shape as the label branch.
      if (result.updated === 0) {
        showToast("No categories changed");
      } else {
        showToast(`${result.updated} transaction${result.updated === 1 ? "" : "s"} updated`);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to change category", "error");
    }
  };

  const handleBulkLabels = async (operation: "add" | "remove", labelIds: string[]) => {
    try {
      const result = await bulkUpdateMutation.mutateAsync({
        ids: Array.from(selectedIds),
        action: "labels",
        operation,
        labelIds,
      });
      setShowBulkLabels(false);
      clearSelection(true);
      if (result.updated === 0) {
        showToast("No label assignments changed");
      } else {
        const verb = operation === "add" ? "added to" : "removed from";
        showToast(
          `Labels ${verb} ${result.updated} transaction${result.updated === 1 ? "" : "s"}`,
        );
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update labels", "error");
    }
  };

  /* ---- Render ---- */

  const deleteLoading = deleteMutation.isPending || bulkDeleteMutation.isPending;
  // Drives the empty state's wording. A source filter with no matches is "nothing matched", not
  // "you have no transactions", which would read as data loss to someone who has plenty.
  const hasActiveSearch = filters.search !== "" || filters.createdVia !== "ALL";

  // Shared by the header dropdown and the FAB that replaces it once the header
  // scrolls away, so the two menus cannot drift apart.
  const addTransactionItems: DropdownItem[] = [
    {
      label: "Add Transaction",
      icon: Plus,
      onClick: () => setShowForm(true),
    },
    {
      label: "Scan Receipt",
      icon: ScanLine,
      onClick: openScan,
      disabled: scanLimitReached,
      sublabel: scanLimitReached
        ? "Monthly limit reached"
        : hasLimit
          ? `${scansRemaining} scan${scansRemaining === 1 ? "" : "s"} left`
          : undefined,
    },
  ];

  return (
    <div className={cn(selectedItems.length > 0 ? "pb-48" : "pb-16", "sm:pb-0")}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {selectionAnnouncement}
      </p>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1
            ref={pageHeadingRef}
            tabIndex={-1}
            className="font-serif text-2xl text-warm-700 outline-none lg:text-3xl"
          >
            Transactions
          </h1>
          <p className="text-warm-400 text-sm mt-1">
            {totalCount !== null
              ? isInfinite
                ? `${allInfiniteTransactions.length} of ${totalCount} loaded`
                : `${totalCount} total`
              : "Loading..."}
          </p>
        </div>
        {canScan ? (
          <DropdownButton
            label="Add Transaction"
            icon={Plus}
            className="hidden sm:inline-flex px-5 py-2.5"
            items={addTransactionItems}
          />
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="hidden sm:inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium text-sm px-5 py-2.5 rounded-xl transition-colors shadow-soft hover:shadow-soft-md"
          >
            <Plus className="w-4 h-4" />
            Add Transaction
          </button>
        )}
      </div>

      {/* Filters Bar */}
      <TransactionFiltersBar
        filters={filters}
        onChange={setFilters}
        totalCount={totalCount}
        filtersRevision={filtersRevision}
        // Both the href and the period it names come from the return blob, never
        // from the filters on this page: a heatmap drill-down filters the ledger to
        // one day while the link returns to the whole analytics span, so a label
        // built from these filters would name somewhere the link does not go.
        returnBar={
          returnTarget ? (
            <ReturnBar
              href={returnTarget.href}
              label="Analytics"
              context={returnTarget.periodLabel}
            />
          ) : undefined
        }
      />

      {/* Transaction List — date-grouped */}
      <div className="card overflow-clip">
        {selectedItems.length > 0 && (
          <TransactionBulkActionBar
            selectedCount={selectedItems.length}
            visibleCount={sourceTransactions.length}
            matchingCount={totalCount}
            visibleState={masterSelectionState}
            layout={isInfinite ? "infinite" : "pagination"}
            allMatchingPending={selectionSnapshotMutation.isPending}
            editPending={bulkEditPending}
            exportPending={exportMutation.isPending}
            updatePending={bulkUpdateMutation.isPending}
            onToggleVisible={toggleSelectAll}
            onSelectAllMatching={handleSelectAllMatching}
            onEdit={handleBulkEdit}
            onCategory={() => setShowBulkCategory(true)}
            onLabels={() => setShowBulkLabels(true)}
            onExport={handleExport}
            onDelete={() => setShowBulkDelete(true)}
            onClear={() => clearSelection(true)}
          />
        )}
        {loading ? (
          <div className="divide-y divide-cream-200">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-4">
                <div className="w-5 h-5 rounded animate-shimmer shrink-0" />
                <div className="w-9 h-9 rounded-xl animate-shimmer shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="w-40 h-4 rounded animate-shimmer" />
                  <div className="w-24 h-3 rounded animate-shimmer" />
                </div>
                <div className="w-20 h-4 rounded animate-shimmer" />
              </div>
            ))}
          </div>
        ) : transactionsError ? (
          <EmptyState
            icon={AlertTriangle}
            title="Couldn’t load transactions"
            description="Check your connection and try loading the transaction list again."
            action={
              <button
                type="button"
                onClick={() => void retryTransactions()}
                className="inline-flex min-h-11 items-center rounded-xl bg-amber px-4 py-2.5 text-sm font-medium text-white shadow-soft transition-colors hover:bg-amber-dark"
              >
                Try again
              </button>
            }
          />
        ) : dateGroups.length > 0 ? (
          <>
            {dateGroups.map((group) => (
              <div key={group.dateKey}>
                {/* Date header */}
                <div
                  data-transaction-date-heading
                  className="flex items-center justify-between px-5 py-2.5 bg-cream-50 border-b border-cream-200"
                >
                  <span className="text-xs font-semibold text-warm-500 uppercase tracking-wide">
                    {group.dateLabel}
                    {user.showDayName && (
                      <span className="text-warm-300 font-normal normal-case tracking-normal ml-1.5">
                        · {user.dayNameFormat === "FULL" ? group.dayNameFull : group.dayNameShort}
                      </span>
                    )}
                  </span>
                  {!hideAmounts && (
                    <span
                      className={cn(
                        "text-xs font-display font-semibold tabular-nums",
                        group.subtotal >= 0 ? "text-income" : "text-expense"
                      )}
                    >
                      {group.subtotal >= 0 ? "+" : "-"}
                      {formatCurrency(Math.abs(group.subtotal), currency)}
                    </span>
                  )}
                </div>

                {/* Transaction rows */}
                <div className="divide-y divide-cream-100">
                  {group.transactions.map((tx) => {
                    const isSelected = selectedIds.has(tx.id);
                    return (
                      <div
                        key={tx.id}
                        data-transaction-id={tx.id}
                        className={cn(
                          "flex items-center gap-3 px-5 py-3 transition-colors group cursor-pointer",
                          highlightedRowId === tx.id && "bg-amber-light/40 ring-1 ring-amber/40",
                          isSelected ? "bg-amber-light/20" : "hover:bg-cream-50/80"
                        )}
                        onClick={() =>
                          selectedItems.length > 0 ? toggleSelection(tx) : setEditingTransaction(tx)
                        }
                      >
                        {/* Checkbox */}
                        <TransactionSelectionCheckbox
                          label={`Select ${tx.description || tx.category.name} transaction`}
                          state={isSelected ? "all" : "none"}
                          onChange={() => toggleSelection(tx)}
                          className="-my-2 -ml-3"
                        />

                        {/* Category icon */}
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                          style={{ backgroundColor: tx.category.color + "18" }}
                        >
                          <CategoryIcon
                            name={tx.category.icon}
                            className="w-4 h-4"
                            style={{ color: tx.category.color }}
                          />
                        </div>

                        {/* Description + category */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-warm-600 truncate">
                              {tx.description}
                            </p>
                            <TransactionRowBadges
                              receiptGroupId={tx.receiptGroupId}
                              billId={tx.billId}
                              createdVia={tx.createdVia}
                            />
                          </div>
                          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                            <p className="text-xs text-warm-300 truncate">
                              {tx.category.name}
                            </p>
                            {tx.labels && tx.labels.length > 0 && (
                              <TransactionLabelPills
                                labels={tx.labels}
                                maxVisible={3}
                                onRemove={(_tlId, labelId) =>
                                  removeLabelMutation.mutate({ transactionId: tx.id, labelId })
                                }
                                removingLabelId={
                                  removeLabelMutation.isPending &&
                                  removeLabelMutation.variables?.transactionId === tx.id
                                    ? removeLabelMutation.variables.labelId
                                    : null
                                }
                                removeDisabled={
                                  removeLabelMutation.isPending || selectedItems.length > 0
                                }
                              />
                            )}
                          </div>
                        </div>

                        {/* Amount + time */}
                        <div className="text-right shrink-0">
                          <p
                            className={cn(
                              "text-sm font-display font-semibold tabular-nums",
                              tx.type === "INCOME" ? "text-income" : "text-expense"
                            )}
                          >
                            {hideAmounts
                              ? "••••"
                              : `${tx.type === "INCOME" ? "+" : "-"}${formatCurrency(tx.amount, currency)}`}
                          </p>
                          <p className="text-[11px] text-warm-300 tabular-nums">
                            {formatTime(tx.date, user.timezoneOffset)}
                          </p>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Infinite scroll: loading + sentinel */}
            {isInfinite && (
              <>
                {loadingMore && (
                  <div className="flex items-center justify-center py-6 border-t border-cream-200">
                    <Loader2 className="w-5 h-5 text-warm-300 animate-spin" />
                    <span className="ml-2 text-sm text-warm-400">Loading more...</span>
                  </div>
                )}
                {!hasMore && allInfiniteTransactions.length > 0 && (
                  <div className="text-center py-4 border-t border-cream-200">
                    <p className="text-xs text-warm-300">All transactions loaded</p>
                  </div>
                )}
                <div ref={sentinelRef} className="h-1" />
              </>
            )}

            {/* Pagination (non-infinite mode) */}
            {!isInfinite && totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-cream-200">
                <p className="text-xs text-warm-400">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-warm-500 hover:bg-cream-100 disabled:opacity-30 transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-warm-500 hover:bg-cream-100 disabled:opacity-30 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={ArrowLeftRight}
            title={hasActiveSearch ? "No matches found" : "No transactions yet"}
            description={
              hasActiveSearch
                ? "Try adjusting your search terms."
                : "Add your first transaction to start tracking."
            }
            action={
              !hasActiveSearch ? (
                <button
                  onClick={() => setShowForm(true)}
                  className="inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-soft"
                >
                  <Plus className="w-4 h-4" />
                  Add Transaction
                </button>
              ) : undefined
            }
          />
        )}
      </div>

      {/* ---- Modals ---- */}

      {/* Add Transaction */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Transaction">
        <TransactionForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
      </Modal>

      {/* Edit Transaction */}
      <Modal
        open={!!editingTransaction}
        onClose={() => setEditingTransaction(null)}
        title="Edit Transaction"
      >
        {editingTransaction && (
          <TransactionForm
            transaction={editingTransaction}
            onSubmit={handleUpdate}
            onCancel={() => setEditingTransaction(null)}
            onDelete={() => {
              const tx = editingTransaction;
              setEditingTransaction(null);
              setDeletingTransaction(tx);
            }}
          />
        )}
      </Modal>

      {/* Single Delete Confirmation */}
      <ConfirmModal
        open={!!deletingTransaction}
        onClose={() => setDeletingTransaction(null)}
        onConfirm={handleDelete}
        title="Delete Transaction"
        message={
          <p>
            Are you sure you want to delete{" "}
            <span className="font-medium text-warm-700">
              &ldquo;{deletingTransaction?.description}&rdquo;
            </span>
            ? This action cannot be undone.
          </p>
        }
        loading={deleteLoading}
      />

      {/* Bulk Delete Confirmation */}
      <ConfirmModal
        open={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedItems.length} transaction${selectedItems.length === 1 ? "" : "s"}`}
        message={
          <div className="space-y-3">
            <p>
              This permanently deletes the selected transaction{selectedItems.length === 1 ? "" : "s"}
              {" "}and updates dashboard and analytics totals. This action cannot be undone.
            </p>
            {selectedItems.length <= 5 && (
              <ul className="list-disc space-y-1 pl-5 text-warm-600">
                {selectedItems.map((item) => (
                  <li key={item.id} className="truncate">{item.description || "Untitled transaction"}</li>
                ))}
              </ul>
            )}
          </div>
        }
        confirmLabel={`Delete ${selectedItems.length}`}
        loading={deleteLoading}
      />

      <TransactionBulkCategoryDialog
        open={showBulkCategory}
        onClose={() => setShowBulkCategory(false)}
        selectedCount={selectedItems.length}
        selectedTypes={selectedTypes}
        pending={bulkUpdateMutation.isPending}
        onApply={handleBulkCategory}
      />

      <TransactionBulkLabelsDialog
        open={showBulkLabels}
        onClose={() => setShowBulkLabels(false)}
        selectedCount={selectedItems.length}
        selectedTypes={selectedTypes}
        pending={bulkUpdateMutation.isPending}
        onApply={handleBulkLabels}
      />

      {/* Floating create button. Above `sm` it carries the same menu as the
          header dropdown, which by then has scrolled out of reach. */}
      <ActionFab
        label="Transaction"
        icon={Plus}
        onClick={() => setShowForm(true)}
        items={canScan ? addTransactionItems : undefined}
        suppressed={selectedItems.length > 0}
      />
    </div>
  );
}
