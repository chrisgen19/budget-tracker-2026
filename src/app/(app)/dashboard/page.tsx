"use client";

import { useState } from "react";
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
} from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { formatCurrency, formatDate, getCurrencySymbol, cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { SpendingChart, TrendChart, BalanceTrendChart } from "@/components/dashboard/charts";
import { DropdownButton, type DropdownItem } from "@/components/ui/dropdown-button";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { useScan } from "@/components/scan-provider";
import { useDashboardQuery, useCreateTransaction } from "@/hooks/use-transactions";
import { useUpcomingBillsQuery } from "@/hooks/use-bills";
import type { TransactionInput } from "@/lib/validations";

export default function DashboardPage() {
  const [showForm, setShowForm] = useState(false);
  const { hideAmounts, toggleHideAmounts } = usePrivacy();
  const { user } = useUser();
  const { canScan, openScan, scanLimitReached, scansRemaining, hasLimit } = useScan();
  const currency = user.currency;
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const { data: stats, isLoading: loading } = useDashboardQuery(currentMonth, user.timezoneOffset);
  const { data: upcomingData } = useUpcomingBillsQuery();
  const createMutation = useCreateTransaction();

  /** Display amount or censored placeholder */
  const displayAmount = (amount: number, colorClass?: string) =>
    hideAmounts ? (
      <span className={cn("font-display font-bold text-2xl tabular-nums", colorClass)}>{getCurrencySymbol(currency)} ••••••</span>
    ) : (
      <span className={cn("font-display font-bold text-2xl tabular-nums", colorClass)}>
        {formatCurrency(amount, currency)}
      </span>
    );

  /** Display inline amount or censored placeholder (for transaction rows) */
  const displayInlineAmount = (amount: number, type: "INCOME" | "EXPENSE") => {
    const colorClass = type === "INCOME" ? "text-income" : "text-expense";
    const prefix = type === "INCOME" ? "+" : "-";
    return hideAmounts ? (
      <span className={cn("text-sm font-display font-semibold tabular-nums", colorClass)}>••••</span>
    ) : (
      <span className={cn("text-sm font-display font-semibold tabular-nums", colorClass)}>
        {prefix}{formatCurrency(amount, currency)}
      </span>
    );
  };

  const handleCreate = async (input: TransactionInput) => {
    await createMutation.mutateAsync(input);
    setShowForm(false);
  };

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
                {upcomingData.bills.slice(0, 3).map((bill) => {
                  const due = new Date(bill.dueDate);
                  due.setHours(0, 0, 0, 0);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  const dueLabel = bill.isOverdue
                    ? `${Math.abs(diffDays)}d overdue`
                    : diffDays === 0
                      ? "Today"
                      : diffDays === 1
                        ? "Tomorrow"
                        : `In ${diffDays}d`;

                  return (
                    <div key={`${bill.id}-${bill.dueDate}`} className="flex items-center gap-3">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: bill.categoryColor + "18" }}
                      >
                        <CategoryIcon
                          name={bill.categoryIcon}
                          className="w-3.5 h-3.5"
                          style={{ color: bill.categoryColor }}
                        />
                      </div>
                      <span className="text-sm text-warm-600 truncate flex-1">
                        {bill.description}
                      </span>
                      <span className={cn(
                        "text-[11px] font-medium shrink-0",
                        bill.isOverdue ? "text-expense" : "text-warm-400"
                      )}>
                        {dueLabel}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-warm-600 shrink-0">
                        {hideAmounts ? "***" : formatCurrency(bill.amount, currency)}
                      </span>
                    </div>
                  );
                })}
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
          <motion.div variants={fadeUp} className="card">
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

            {stats.recentTransactions.length > 0 ? (
              <div className="divide-y divide-cream-200">
                {stats.recentTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-cream-50 transition-colors"
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
                      <p className="text-sm font-medium text-warm-600 truncate">
                        {tx.description}
                      </p>
                      <p className="text-xs text-warm-300">
                        {tx.category.name} &middot; {formatDate(tx.date)}
                      </p>
                    </div>
                    {displayInlineAmount(tx.amount, tx.type)}
                  </div>
                ))}
              </div>
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

      {/* Mobile FAB — sits above bottom nav */}
      <button
        onClick={() => setShowForm(true)}
        className="sm:hidden fixed bottom-20 right-4 z-20 inline-flex items-center gap-1.5 px-4 py-3 rounded-full bg-amber hover:bg-amber-dark text-white font-medium text-sm shadow-soft-lg active:scale-95 transition-all"
      >
        <Plus className="w-4 h-4" />
        Transaction
      </button>

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
      <div className="card">
        <div className="flex items-center justify-between p-5 pb-3">
          <div className="w-40 h-5 rounded animate-shimmer" />
          <div className="w-16 h-4 rounded animate-shimmer" />
        </div>
        <div className="divide-y divide-cream-200">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <div className="w-9 h-9 rounded-xl animate-shimmer shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="w-32 h-4 rounded animate-shimmer" />
                <div className="w-24 h-3 rounded animate-shimmer" />
              </div>
              <div className="w-20 h-4 rounded animate-shimmer" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
