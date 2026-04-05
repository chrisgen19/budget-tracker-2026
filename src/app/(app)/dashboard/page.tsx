"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Plus,
  Eye,
  EyeOff,
  ScanLine,
  CalendarClock,
  Receipt,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { formatCurrency, getCurrencySymbol, cn } from "@/lib/utils";
import { groupByDate, formatTime } from "@/lib/transaction-helpers";
import { CategoryIcon } from "@/components/ui/icon-map";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { SpendingChart, TrendChart, BalanceTrendChart } from "@/components/dashboard/charts";
import { DropdownButton, type DropdownItem } from "@/components/ui/dropdown-button";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { useScan } from "@/components/scan-provider";
import { useDashboardQuery, useCreateTransaction, useUpdateTransaction, useDeleteTransaction, useRemoveTransactionLabel } from "@/hooks/use-transactions";
import { useUpcomingBillsQuery } from "@/hooks/use-bills";
import { UpcomingBillRow } from "@/components/dashboard/upcoming-bill-row";
import { TransactionLabelPills } from "@/components/transactions/transaction-label-pills";
import { MobileFab } from "@/components/ui/mobile-fab";
import type { TransactionInput } from "@/lib/validations";
import type { TransactionWithCategory } from "@/types";

export default function DashboardPage() {
  const [showForm, setShowForm] = useState(false);
  const [shouldScrollToRecent, setShouldScrollToRecent] = useState(false);
  const recentTransactionsRef = useRef<HTMLDivElement>(null);
  const { hideAmounts, toggleHideAmounts } = usePrivacy();
  const { user } = useUser();
  const { canScan, openScan, scanLimitReached, scansRemaining, hasLimit } = useScan();
  const currency = user.currency;
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const [editingTransaction, setEditingTransaction] = useState<TransactionWithCategory | null>(null);
  const [deletingTransaction, setDeletingTransaction] = useState<TransactionWithCategory | null>(null);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);

  const { data: stats, isLoading: loading } = useDashboardQuery(currentMonth, user.timezoneOffset);
  const { data: upcomingData } = useUpcomingBillsQuery(user.timezoneOffset);
  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();
  const removeLabelMutation = useRemoveTransactionLabel();

  /** Display amount or censored placeholder */
  const displayAmount = (amount: number, colorClass?: string) =>
    hideAmounts ? (
      <span className={cn("font-display font-bold text-2xl tabular-nums", colorClass)}>{getCurrencySymbol(currency)} ••••••</span>
    ) : (
      <span className={cn("font-display font-bold text-2xl tabular-nums", colorClass)}>
        {formatCurrency(amount, currency)}
      </span>
    );

  const handleCreate = async (input: TransactionInput) => {
    await createMutation.mutateAsync(input);
    setShowForm(false);
    setShouldScrollToRecent(true);
  };

  const handleUpdate = async (input: TransactionInput) => {
    if (!editingTransaction) return;
    await updateMutation.mutateAsync({ id: editingTransaction.id, input });
    setEditingTransaction(null);
  };

  const handleDelete = async () => {
    if (!deletingTransaction) return;
    await deleteMutation.mutateAsync(deletingTransaction.id);
    setDeletingTransaction(null);
  };

  const recentDateGroups = useMemo(
    () => (stats?.recentTransactions ? groupByDate(stats.recentTransactions) : []),
    [stats?.recentTransactions],
  );

  useEffect(() => {
    if (!shouldScrollToRecent || showForm) return;

    const timeoutId = window.setTimeout(() => {
      recentTransactionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setShouldScrollToRecent(false);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [shouldScrollToRecent, showForm]);

  const navigateMonth = (direction: -1 | 1) => {
    const [year, month] = currentMonth.split("-").map(Number);
    const d = new Date(year, month - 1 + direction, 1);
    setCurrentMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  };

  const monthLabel = (() => {
    const [year, month] = currentMonth.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
      new Date(year, month - 1)
    );
  })();

  const stagger = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.08 },
    },
  };

  const fadeUp = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-2xl lg:text-3xl text-warm-700">
            Dashboard
          </h1>
          <p className="text-warm-400 text-sm mt-1">
            Your financial overview at a glance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Add Transaction Button — desktop only */}
          {canScan ? (
            <DropdownButton
              label="Add Transaction"
              icon={Plus}
              className="hidden sm:inline-flex"
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
              className="hidden sm:inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium text-sm px-4 py-2 rounded-xl transition-colors shadow-soft hover:shadow-soft-md"
            >
              <Plus className="w-4 h-4" />
              Add Transaction
            </button>
          )}

          {/* Month Navigator */}
          <div className="flex items-center gap-2 bg-white rounded-xl border border-cream-300/60 shadow-warm px-2 py-1.5">
          <button
            onClick={() => navigateMonth(-1)}
            className="p-1.5 rounded-lg text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-warm-600 min-w-[120px] text-center">
            {monthLabel}
          </span>
          <button
            onClick={() => navigateMonth(1)}
            className="p-1.5 rounded-lg text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        </div>
      </div>

      {loading ? (
        <DashboardSkeleton />
      ) : stats ? (
        <motion.div variants={stagger} initial="hidden" animate="show">
          {/* Summary Cards — horizontal scroll on mobile, grid on desktop */}
          {/* Order: Running Balance (most important) → Expenses → Income */}
          <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-2 mb-8 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0">
            <motion.div variants={fadeUp} className="card p-5 grain-overlay min-w-[260px] shrink-0 snap-start sm:min-w-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
                    <Wallet className="w-5 h-5 text-amber" />
                  </div>
                  <div>
                    <span className="text-sm text-warm-400">Running Balance</span>
                    <p className="text-xs text-warm-300">Cumulative</p>
                  </div>
                </div>
                <button
                  onClick={toggleHideAmounts}
                  className="p-1.5 rounded-lg text-warm-300 hover:text-warm-600 hover:bg-cream-200/60 transition-colors"
                  title={hideAmounts ? "Show amounts" : "Hide amounts"}
                >
                  {hideAmounts ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {displayAmount(stats.runningBalance, stats.runningBalance >= 0 ? "text-income" : "text-expense")}
            </motion.div>

            <motion.div variants={fadeUp} className="card p-5 grain-overlay min-w-[260px] shrink-0 snap-start sm:min-w-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-expense-light flex items-center justify-center">
                    <TrendingDown className="w-5 h-5 text-expense" />
                  </div>
                  <div>
                    <span className="text-sm text-warm-400">Expenses</span>
                    <p className="text-xs text-warm-300">This month</p>
                  </div>
                </div>
                <button
                  onClick={toggleHideAmounts}
                  className="p-1.5 rounded-lg text-warm-300 hover:text-warm-600 hover:bg-cream-200/60 transition-colors"
                  title={hideAmounts ? "Show amounts" : "Hide amounts"}
                >
                  {hideAmounts ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {displayAmount(stats.totalExpenses, "text-expense")}
            </motion.div>

            <motion.div variants={fadeUp} className="card p-5 grain-overlay min-w-[260px] shrink-0 snap-start sm:min-w-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-income-light flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-income" />
                  </div>
                  <div>
                    <span className="text-sm text-warm-400">Income</span>
                    <p className="text-xs text-warm-300">This month</p>
                  </div>
                </div>
                <button
                  onClick={toggleHideAmounts}
                  className="p-1.5 rounded-lg text-warm-300 hover:text-warm-600 hover:bg-cream-200/60 transition-colors"
                  title={hideAmounts ? "Show amounts" : "Hide amounts"}
                >
                  {hideAmounts ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {displayAmount(stats.totalIncome, "text-income")}
            </motion.div>
          </div>

          {/* Upcoming Bills */}
          {upcomingData && upcomingData.count > 0 && (
            <motion.div variants={fadeUp} className="card p-5 mb-8">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
                    <CalendarClock className="w-5 h-5 text-amber" />
                  </div>
                  <div>
                    <h2 className="text-sm font-medium text-warm-700">Upcoming Bills</h2>
                    <p className="text-xs text-warm-400">
                      {upcomingData.count} bill{upcomingData.count > 1 ? "s" : ""} due this week
                      {!hideAmounts && (
                        <span className="text-warm-500 font-medium">
                          {" "}&middot; {formatCurrency(upcomingData.totalAmount, currency)} total
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {upcomingData.count > 3 && (
                  <Link
                    href="/bills"
                    className="text-xs text-amber hover:text-amber-dark font-medium flex items-center gap-1 transition-colors"
                  >
                    View all
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
              <div className="space-y-2">
                <AnimatePresence mode="popLayout">
                  {upcomingData.bills.slice(0, 3).map((bill) => (
                    <UpcomingBillRow
                      key={`${bill.id}-${bill.dueDate}`}
                      bill={bill}
                      currency={currency}
                      hideAmounts={hideAmounts}
                      isExpanded={expandedBillId === bill.id}
                      onToggleExpand={() =>
                        setExpandedBillId((prev) => (prev === bill.id ? null : bill.id))
                      }
                      onActionComplete={() => setExpandedBillId(null)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* Balance Trend */}
          <motion.div variants={fadeUp} className="card p-5 mb-8">
            {stats.balanceTrend.length > 0 ? (
              <BalanceTrendChart
                data={stats.balanceTrend}
                hideAmounts={hideAmounts}
                currency={currency}
              />
            ) : (
              <div>
                <h2 className="font-serif text-lg text-warm-700">Balance Trend</h2>
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-warm-300 text-sm">No data yet</p>
                </div>
              </div>
            )}
          </motion.div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
            <motion.div variants={fadeUp} className="card p-5">
              <h2 className="font-serif text-lg text-warm-700 mb-4">
                Monthly Trend
              </h2>
              {stats.monthlyTrend.some((m) => m.income > 0 || m.expenses > 0) ? (
                <TrendChart data={stats.monthlyTrend} currency={currency} />
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-warm-300 text-sm">No data yet</p>
                </div>
              )}
            </motion.div>

            <motion.div variants={fadeUp} className="card p-5">
              <h2 className="font-serif text-lg text-warm-700 mb-4">
                Spending by Category
              </h2>
              {stats.categoryBreakdown.length > 0 ? (
                <SpendingChart data={stats.categoryBreakdown} currency={currency} />
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-warm-300 text-sm">No expenses this month</p>
                </div>
              )}
            </motion.div>
          </div>

          {/* Recent Transactions */}
          <motion.div ref={recentTransactionsRef} variants={fadeUp} className="card overflow-hidden">
            <div className="flex items-center justify-between p-5 pb-3">
              <h2 className="font-serif text-lg text-warm-700">
                Recent Transactions
              </h2>
              <Link
                href="/transactions"
                className="text-sm text-amber hover:text-amber-dark font-medium flex items-center gap-1 transition-colors"
              >
                View All
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {recentDateGroups.length > 0 ? (
              <>
                {recentDateGroups.map((group) => (
                  <div key={group.dateKey}>
                    {/* Date header */}
                    <div className="flex items-center justify-between px-5 py-2.5 bg-cream-50 border-b border-cream-200">
                      <span className="text-xs font-semibold text-warm-500 uppercase tracking-wide">
                        {group.dateLabel}
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
                      {group.transactions.map((tx) => (
                        <div
                          key={tx.id}
                          className="flex items-center gap-3 px-5 py-3 hover:bg-cream-50/80 transition-colors cursor-pointer"
                          onClick={() => setEditingTransaction(tx)}
                        >
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
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium text-warm-600 truncate">
                                {tx.description}
                              </p>
                              {tx.receiptGroupId && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 bg-amber-light/60 text-amber-dark text-[10px] font-medium px-1.5 py-0.5 rounded">
                                  <Receipt className="w-2.5 h-2.5" />
                                  Itemized
                                </span>
                              )}
                              {tx.billId && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 bg-income-light text-income text-[10px] font-medium px-1.5 py-0.5 rounded">
                                  <CalendarClock className="w-2.5 h-2.5" />
                                  Bill
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 min-w-0">
                              <p className="text-xs text-warm-300 truncate">
                                {tx.category.name}
                              </p>
                              {tx.labels && tx.labels.length > 0 && (
                                <TransactionLabelPills
                                  labels={tx.labels}
                                  maxVisible={2}
                                  onRemove={(_tlId, labelId) =>
                                    removeLabelMutation.mutate({ transactionId: tx.id, labelId })
                                  }
                                />
                              )}
                            </div>
                          </div>
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
                              {formatTime(tx.date)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No transactions yet"
                description="Add your first transaction to see your financial overview."
                action={
                  <button
                    onClick={() => setShowForm(true)}
                    className="inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-soft"
                  >
                    <Plus className="w-4 h-4" />
                    Add Transaction
                  </button>
                }
              />
            )}
          </motion.div>
        </motion.div>
      ) : null}

      {/* Mobile FAB */}
      <MobileFab label="Transaction" icon={Plus} onClick={() => setShowForm(true)} />

      {/* Add Transaction Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New Transaction"
      >
        <TransactionForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      {/* Edit Transaction Modal */}
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

      {/* Delete Confirmation */}
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
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div>
      {/* Summary Cards — horizontal scroll on mobile, grid on desktop */}
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-2 mb-8 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-5 min-w-[260px] shrink-0 snap-start sm:min-w-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl animate-shimmer" />
                <div className="space-y-1.5">
                  <div className="w-24 h-4 rounded animate-shimmer" />
                  <div className="w-16 h-3 rounded animate-shimmer" />
                </div>
              </div>
              <div className="w-7 h-7 rounded-lg animate-shimmer" />
            </div>
            <div className="w-32 h-8 rounded animate-shimmer" />
          </div>
        ))}
      </div>

      {/* Balance Trend */}
      <div className="card p-5 mb-8">
        <div className="w-32 h-5 rounded animate-shimmer mb-2" />
        <div className="w-48 h-3 rounded animate-shimmer mb-4" />
        <div className="flex items-start justify-between mb-4">
          <div className="space-y-1">
            <div className="w-12 h-3 rounded animate-shimmer" />
            <div className="w-28 h-6 rounded animate-shimmer" />
          </div>
          <div className="space-y-1">
            <div className="w-16 h-3 rounded animate-shimmer" />
            <div className="w-16 h-6 rounded-full animate-shimmer" />
          </div>
        </div>
        <div className="h-[180px] rounded-xl animate-shimmer" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {[1, 2].map((i) => (
          <div key={i} className="card p-5">
            <div className="w-32 h-5 rounded animate-shimmer mb-4" />
            <div className="h-[220px] rounded-xl animate-shimmer" />
          </div>
        ))}
      </div>

      {/* Recent Transactions */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-3">
          <div className="w-40 h-5 rounded animate-shimmer" />
          <div className="w-16 h-4 rounded animate-shimmer" />
        </div>
        {/* Skeleton date group */}
        <div className="flex items-center justify-between px-5 py-2.5 bg-cream-50 border-b border-cream-200">
          <div className="w-32 h-3 rounded animate-shimmer" />
          <div className="w-16 h-3 rounded animate-shimmer" />
        </div>
        <div className="divide-y divide-cream-100">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <div className="w-9 h-9 rounded-xl animate-shimmer shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="w-32 h-4 rounded animate-shimmer" />
                <div className="w-24 h-3 rounded animate-shimmer" />
              </div>
              <div className="space-y-1.5 shrink-0">
                <div className="w-20 h-4 rounded animate-shimmer" />
                <div className="w-14 h-3 rounded animate-shimmer ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
