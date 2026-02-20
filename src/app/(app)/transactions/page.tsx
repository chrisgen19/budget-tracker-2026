"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Search,
  Trash2,
  Pencil,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Check,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatCurrency, cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import type { TransactionInput } from "@/lib/validations";
import type { TransactionWithCategory } from "@/types";

/* ------------------------------------------------------------------ */
/*  Types & helpers                                                    */
/* ------------------------------------------------------------------ */

interface TransactionsResponse {
  transactions: TransactionWithCategory[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface DateGroup {
  dateKey: string;
  dateLabel: string;
  transactions: TransactionWithCategory[];
  subtotal: number;
}

/** Format date key from a Date: "2026-02-18" */
const toDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "2026-02-18" → "February 18, 2026" */
const formatDateLabel = (key: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(key + "T00:00:00"));

/** Date object → "3:27 PM" */
const formatTime = (date: string | Date) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));

/** Group transactions by date, sorted most recent first */
const groupByDate = (transactions: TransactionWithCategory[]): DateGroup[] => {
  const map = new Map<string, TransactionWithCategory[]>();

  for (const tx of transactions) {
    const key = toDateKey(new Date(tx.date));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tx);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, txs]) => ({
      dateKey: key,
      dateLabel: formatDateLabel(key),
      transactions: txs,
      subtotal: txs.reduce(
        (sum, t) => sum + (t.type === "INCOME" ? t.amount : -t.amount),
        0
      ),
    }));
};

/** Generate CSV string from transactions */
const generateCsv = (transactions: TransactionWithCategory[]) => {
  const header = ["Date", "Time", "Description", "Category", "Type", "Amount"];
  const rows = transactions.map((tx) => {
    const d = new Date(tx.date);
    return [
      d.toLocaleDateString("en-US"),
      formatTime(d),
      `"${tx.description.replace(/"/g, '""')}"`,
      `"${tx.category.name}"`,
      tx.type,
      tx.type === "INCOME" ? tx.amount : -tx.amount,
    ];
  });
  return [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
};

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function TransactionsPage() {
  const { hideAmounts } = usePrivacy();
  const { user } = useUser();
  const currency = user.currency;
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal states
  const [showForm, setShowForm] = useState(false);
  const [editingTransaction, setEditingTransaction] =
    useState<TransactionWithCategory | null>(null);
  const [deletingTransaction, setDeletingTransaction] =
    useState<TransactionWithCategory | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  /* ---- Data fetching ---- */

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "15", month });
    if (filter !== "ALL") params.set("type", filter);
    const res = await fetch(`/api/transactions?${params}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [page, month, filter]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Reset page & selection when filters change
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [filter, month]);

  /* ---- Filtered & grouped data ---- */

  const filteredTransactions = data?.transactions.filter((tx) =>
    search
      ? tx.description.toLowerCase().includes(search.toLowerCase()) ||
        tx.category.name.toLowerCase().includes(search.toLowerCase())
      : true
  );

  const dateGroups = filteredTransactions ? groupByDate(filteredTransactions) : [];

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
    if (!filteredTransactions) return;
    const allIds = filteredTransactions.map((tx) => tx.id);
    const allSelected = allIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const allSelected =
    filteredTransactions &&
    filteredTransactions.length > 0 &&
    filteredTransactions.every((tx) => selectedIds.has(tx.id));

  /* ---- CRUD handlers ---- */

  const handleCreate = async (input: TransactionInput) => {
    await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    setShowForm(false);
    fetchTransactions();
  };

  const handleUpdate = async (input: TransactionInput) => {
    if (!editingTransaction) return;
    await fetch(`/api/transactions/${editingTransaction.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    setEditingTransaction(null);
    fetchTransactions();
  };

  const handleDelete = async () => {
    if (!deletingTransaction) return;
    setDeleteLoading(true);
    await fetch(`/api/transactions/${deletingTransaction.id}`, { method: "DELETE" });
    setDeleteLoading(false);
    setDeletingTransaction(null);
    fetchTransactions();
  };

  const handleBulkDelete = async () => {
    setDeleteLoading(true);
    await Promise.all(
      Array.from(selectedIds).map((id) =>
        fetch(`/api/transactions/${id}`, { method: "DELETE" })
      )
    );
    setDeleteLoading(false);
    setShowBulkDelete(false);
    setSelectedIds(new Set());
    fetchTransactions();
  };

  const handleExport = () => {
    if (!filteredTransactions || selectedIds.size === 0) return;
    const selected = filteredTransactions.filter((tx) => selectedIds.has(tx.id));
    const csv = generateCsv(selected);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkEdit = () => {
    if (selectedIds.size !== 1 || !filteredTransactions) return;
    const tx = filteredTransactions.find((t) => selectedIds.has(t.id));
    if (tx) {
      setEditingTransaction(tx);
      clearSelection();
    }
  };

  /* ---- Month navigation ---- */

  const navigateMonth = (direction: -1 | 1) => {
    const [year, m] = month.split("-").map(Number);
    const d = new Date(year, m - 1 + direction, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const monthLabel = (() => {
    const [year, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
      new Date(year, m - 1)
    );
  })();

  /* ---- Render ---- */

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl lg:text-3xl text-warm-700">Transactions</h1>
          <p className="text-warm-400 text-sm mt-1">
            {data ? `${data.pagination.total} total` : "Loading..."}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium text-sm px-5 py-2.5 rounded-xl transition-colors shadow-soft hover:shadow-soft-md"
        >
          <Plus className="w-4 h-4" />
          Add Transaction
        </button>
      </div>

      {/* Filters Bar */}
      <div className="card p-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-300" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transactions..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-cream-200 bg-cream-50/50 text-sm text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/20 focus:border-amber transition-all"
            />
          </div>

          {/* Type Filter */}
          <div className="flex gap-1 p-0.5 bg-cream-100 rounded-lg">
            {(["ALL", "INCOME", "EXPENSE"] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={cn(
                  "px-4 py-2 rounded-md text-xs font-medium transition-all duration-150",
                  filter === type
                    ? "bg-white text-warm-700 shadow-warm"
                    : "text-warm-400 hover:text-warm-600"
                )}
              >
                {type === "ALL" ? "All" : type === "INCOME" ? "Income" : "Expenses"}
              </button>
            ))}
          </div>

          {/* Month Navigator */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => navigateMonth(-1)}
              className="p-2 rounded-lg text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-warm-600 min-w-[110px] text-center">
              {monthLabel}
            </span>
            <button
              onClick={() => navigateMonth(1)}
              className="p-2 rounded-lg text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

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
      <div className="card overflow-hidden">
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
                <div className="flex items-center justify-between px-5 py-2.5 bg-cream-50 border-b border-cream-200 sticky top-0 z-10">
                  <span className="text-xs font-semibold text-warm-500 uppercase tracking-wide">
                    {group.dateLabel}
                  </span>
                  {!hideAmounts && (
                    <span
                      className={cn(
                        "text-xs font-medium tabular-nums",
                        group.subtotal >= 0 ? "text-income" : "text-expense"
                      )}
                    >
                      {group.subtotal >= 0 ? "+" : ""}
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
                        className={cn(
                          "flex items-center gap-3 px-5 py-3 transition-colors group cursor-pointer",
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
                          <p className="text-sm font-medium text-warm-600 truncate">
                            {tx.description}
                          </p>
                          <p className="text-xs text-warm-300 truncate">
                            {tx.category.name}
                          </p>
                        </div>

                        {/* Amount + time */}
                        <div className="text-right shrink-0">
                          <p
                            className={cn(
                              "text-sm font-medium tabular-nums",
                              tx.type === "INCOME" ? "text-income" : "text-expense"
                            )}
                          >
                            {hideAmounts
                              ? "••••"
                              : `${tx.type === "INCOME" ? "+" : "-"}${formatCurrency(tx.amount, currency)}`}
                          </p>
                          <p className="text-[11px] text-warm-300 tabular-nums">
                            {formatTime(tx.date)}
                          </p>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Pagination */}
            {data && data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-cream-200">
                <p className="text-xs text-warm-400">
                  Page {data.pagination.page} of {data.pagination.totalPages}
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
                    disabled={page >= data.pagination.totalPages}
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
            title={search ? "No matches found" : "No transactions yet"}
            description={
              search
                ? "Try adjusting your search terms."
                : "Add your first transaction to start tracking."
            }
            action={
              !search ? (
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
      <Modal
        open={!!deletingTransaction}
        onClose={() => setDeletingTransaction(null)}
        title="Delete Transaction"
      >
        <p className="text-warm-500 text-sm mb-6">
          Are you sure you want to delete{" "}
          <span className="font-medium text-warm-700">
            &ldquo;{deletingTransaction?.description}&rdquo;
          </span>
          ? This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeletingTransaction(null)}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteLoading}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-expense hover:bg-expense-dark text-white font-medium text-sm transition-colors disabled:opacity-50"
          >
            {deleteLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Delete
              </>
            )}
          </button>
        </div>
      </Modal>

      {/* Bulk Delete Confirmation */}
      <Modal
        open={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        title="Delete Transactions"
      >
        <p className="text-warm-500 text-sm mb-6">
          Are you sure you want to delete{" "}
          <span className="font-medium text-warm-700">
            {selectedIds.size} transaction{selectedIds.size > 1 ? "s" : ""}
          </span>
          ? This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setShowBulkDelete(false)}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={deleteLoading}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-expense hover:bg-expense-dark text-white font-medium text-sm transition-colors disabled:opacity-50"
          >
            {deleteLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                {`Delete ${selectedIds.size}`}
              </>
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}
