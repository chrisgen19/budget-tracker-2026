"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Pencil,
  ArrowLeftRight,
  Download,
  Check,
  X,
  Loader2,
  ScanLine,
} from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
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
import { MobileFab } from "@/components/ui/mobile-fab";
import { TransactionLabelPills } from "@/components/transactions/transaction-label-pills";
import { TransactionRowBadges } from "@/components/transactions/transaction-row-badges";
import {
  fetchTransactionsPage,
  queryKeys,
  useTransactionsQuery,
  useTransactionsInfiniteQuery,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useBulkDeleteTransactions,
  useRemoveTransactionLabel,
} from "@/hooks/use-transactions";
import type { TransactionInput } from "@/lib/validations";
import { groupByDate, formatTime } from "@/lib/transaction-helpers";
import { accountMonthKey } from "@/lib/account-time";
import { generateTransactionsCsv } from "@/lib/transaction-csv";
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

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal states
  const [showForm, setShowForm] = useState(false);
  const [editingTransaction, setEditingTransaction] =
    useState<TransactionWithCategory | null>(null);
  const [deletingTransaction, setDeletingTransaction] =
    useState<TransactionWithCategory | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
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
  const removeLabelMutation = useRemoveTransactionLabel();

  // Reset page & selection when filters change
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [filters]);

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

  const dateGroups = groupByDate(sourceTransactions, user.timezoneOffset);

  /* ---- Selection handlers ---- */

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (sourceTransactions.length === 0) return;
    const allIds = sourceTransactions.map((tx) => tx.id);
    const allSelected = allIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const allSelected =
    sourceTransactions.length > 0 &&
    sourceTransactions.every((tx) => selectedIds.has(tx.id));

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
    await deleteMutation.mutateAsync(deletingTransaction.id);
    setDeletingTransaction(null);
  };

  const handleBulkDelete = async () => {
    await bulkDeleteMutation.mutateAsync(Array.from(selectedIds));
    setShowBulkDelete(false);
    setSelectedIds(new Set());
  };

  const handleExport = () => {
    if (sourceTransactions.length === 0 || selectedIds.size === 0) return;
    const selected = sourceTransactions.filter((tx) => selectedIds.has(tx.id));
    const csv = generateTransactionsCsv(selected, user.timezoneOffset);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${filters.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkEdit = () => {
    if (selectedIds.size !== 1 || sourceTransactions.length === 0) return;
    const tx = sourceTransactions.find((t) => selectedIds.has(t.id));
    if (tx) {
      setEditingTransaction(tx);
      clearSelection();
    }
  };

  /* ---- Render ---- */

  const deleteLoading = deleteMutation.isPending || bulkDeleteMutation.isPending;
  // Drives the empty state's wording. A source filter with no matches is "nothing matched", not
  // "you have no transactions", which would read as data loss to someone who has plenty.
  const hasActiveSearch = filters.search !== "" || filters.createdVia !== "ALL";

  return (
    <div className="pb-16 sm:pb-0">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl lg:text-3xl text-warm-700">Transactions</h1>
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
            items={[
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
            ] satisfies DropdownItem[]}
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

      {/* Bulk Actions Bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="card p-3 border-amber/30 bg-amber-light/20">
              <div className="flex items-center gap-3 flex-wrap">
                {/* Select all checkbox */}
                <button
                  onClick={toggleSelectAll}
                  className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                    allSelected
                      ? "bg-amber border-amber text-white"
                      : "border-warm-300 hover:border-amber/50"
                  )}
                >
                  {allSelected && <Check className="w-3 h-3" />}
                </button>

                <span className="text-sm font-medium text-warm-600">
                  {selectedIds.size} selected
                </span>

                <div className="flex-1" />

                {/* Bulk action buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBulkEdit}
                    disabled={selectedIds.size !== 1}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-warm-500 hover:bg-cream-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={handleExport}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-warm-500 hover:bg-cream-100 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export
                  </button>
                  <button
                    onClick={() => setShowBulkDelete(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-expense hover:bg-expense-light transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>

                {/* Clear selection */}
                <button
                  onClick={clearSelection}
                  className="p-1.5 rounded-lg text-warm-400 hover:text-warm-600 hover:bg-cream-200/60 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transaction List — date-grouped */}
      <div className="card overflow-clip">
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
        ) : dateGroups.length > 0 ? (
          <>
            {dateGroups.map((group) => (
              <div key={group.dateKey}>
                {/* Date header */}
                <div
                  data-transaction-date-heading
                  className="flex items-center justify-between px-5 py-2.5 bg-cream-50 border-b border-cream-200 sticky top-16 lg:top-0 z-10"
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
                        onClick={() => setEditingTransaction(tx)}
                      >
                        {/* Checkbox */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelection(tx.id);
                          }}
                          className={cn(
                            "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                            isSelected
                              ? "bg-amber border-amber text-white"
                              : "border-cream-300 hover:border-amber/50"
                          )}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                        </button>

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
                                removeDisabled={removeLabelMutation.isPending}
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
        title="Delete Transactions"
        message={
          <p>
            Are you sure you want to delete{" "}
            <span className="font-medium text-warm-700">
              {selectedIds.size} transaction{selectedIds.size > 1 ? "s" : ""}
            </span>
            ? This action cannot be undone.
          </p>
        }
        confirmLabel={`Delete ${selectedIds.size}`}
        loading={deleteLoading}
      />

      {/* Mobile FAB */}
      <MobileFab
        label="Transaction"
        icon={Plus}
        compact
        hideWhileScrolling
        onClick={() => setShowForm(true)}
      />
    </div>
  );
}
