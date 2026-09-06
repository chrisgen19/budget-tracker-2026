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
import { accountMonthKey } from "@/lib/account-time";
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

/** Build initial filters with current month */
const createInitialFilters = (timezoneOffset: number): TransactionFilters => {
  return {
    search: "",
    type: "ALL",
    month: accountMonthKey(new Date(), timezoneOffset),
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
    // If highlighting a transaction, clear the month filter so we search all data
    if (searchParams.get("highlight")) {
      return { ...createInitialFilters(user.timezoneOffset), month: "ALL" };
    }
    return createInitialFilters(user.timezoneOffset);
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
  const highlightHandledRef = useRef(false);

  const handleHighlight = useCallback((transactions: TransactionWithCategory[]) => {
    if (!highlightId || highlightHandledRef.current) return;
    const tx = transactions.find((t) => t.id === highlightId);
    if (tx) {
      highlightHandledRef.current = true;
      setEditingTransaction(tx);
      // Leave the all-time lookup on the transaction's own account-local month so the
      // month arrows keep their normal meaning after the edit modal closes.
      const transactionMonth = accountMonthKey(tx.date, user.timezoneOffset);
      setFilters((current) =>
        current.month === transactionMonth
          ? current
          : { ...current, month: transactionMonth }
      );
      // Clean up URL
      router.replace("/transactions", { scroll: false });
    }
  }, [highlightId, router, user.timezoneOffset]);

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

  // Auto-open highlighted transaction from query param
  useEffect(() => {
    if (sourceTransactions.length > 0) {
      handleHighlight(sourceTransactions);
    }
  }, [sourceTransactions, handleHighlight]);

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
      anchor.download = `transactions-${filters.month}.csv`;
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
      // `updated` counts the rows whose category actually moved, so re-applying the category a
      // selection already has reports zero rather than the size of the selection. Worded like the
      // label branch below, which has always had this case: "0 transactions updated" reads as a
      // failure, where nothing needing to change is a success.
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
