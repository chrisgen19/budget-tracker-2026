"use client";

import { useEffect, useState, useCallback } from "react";
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
} from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { SpendingChart, TrendChart, BalanceTrendChart } from "@/components/dashboard/charts";
import { usePrivacy } from "@/components/privacy-provider";
import type { TransactionInput } from "@/lib/validations";
import type { DashboardStats } from "@/types";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const { hideAmounts, toggleHideAmounts } = usePrivacy();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const fetchStats = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/dashboard?month=${currentMonth}`);
    const data = await res.json();
    setStats(data);
    setLoading(false);
  }, [currentMonth]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  /** Display amount or censored placeholder */
  const displayAmount = (amount: number, colorClass?: string) =>
    hideAmounts ? (
      <span className={cn("font-serif text-2xl", colorClass)}>₱ ••••••</span>
    ) : (
      <span className={cn("font-serif text-2xl", colorClass)}>
        {formatCurrency(amount)}
      </span>
    );

  /** Display inline amount or censored placeholder (for transaction rows) */
  const displayInlineAmount = (amount: number, type: "INCOME" | "EXPENSE") => {
    const colorClass = type === "INCOME" ? "text-income" : "text-expense";
    const prefix = type === "INCOME" ? "+" : "-";
    return hideAmounts ? (
      <span className={cn("text-sm font-medium tabular-nums", colorClass)}>••••</span>
    ) : (
      <span className={cn("text-sm font-medium tabular-nums", colorClass)}>
        {prefix}{formatCurrency(amount)}
      </span>
    );
  };

  const handleCreate = async (input: TransactionInput) => {
    await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    setShowForm(false);
    fetchStats();
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
          <button
            onClick={() => setShowForm(true)}
            className="hidden sm:inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium text-sm px-4 py-2 rounded-xl transition-colors shadow-soft hover:shadow-soft-md"
          >
            <Plus className="w-4 h-4" />
            Add Transaction
          </button>

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

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
            <motion.div variants={fadeUp} className="card p-5">
              <h2 className="font-serif text-lg text-warm-700 mb-4">
                Monthly Trend
              </h2>
              {stats.monthlyTrend.some((m) => m.income > 0 || m.expenses > 0) ? (
                <TrendChart data={stats.monthlyTrend} />
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
                <SpendingChart data={stats.categoryBreakdown} />
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-warm-300 text-sm">No expenses this month</p>
                </div>
              )}
            </motion.div>
          </div>

          {/* Balance Trend */}
          <motion.div variants={fadeUp} className="card p-5 mb-8">
            {stats.balanceTrend.length > 0 ? (
              <BalanceTrendChart
                data={stats.balanceTrend}
                hideAmounts={hideAmounts}
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
        className="sm:hidden fixed bottom-20 right-4 z-20 w-14 h-14 rounded-full bg-amber hover:bg-amber-dark text-white shadow-soft-lg active:scale-95 transition-all flex items-center justify-center"
      >
        <Plus className="w-6 h-6" />
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl animate-shimmer" />
              <div className="w-16 h-4 rounded animate-shimmer" />
            </div>
            <div className="w-32 h-8 rounded animate-shimmer" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {[1, 2].map((i) => (
          <div key={i} className="card p-5">
            <div className="w-32 h-5 rounded animate-shimmer mb-4" />
            <div className="h-[220px] rounded-xl animate-shimmer" />
          </div>
        ))}
      </div>
      <div className="card p-5">
        <div className="w-40 h-5 rounded animate-shimmer mb-4" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 py-3">
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
  );
}
