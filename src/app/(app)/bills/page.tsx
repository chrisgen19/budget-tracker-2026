"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, CalendarClock, X, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatCurrency } from "@/lib/utils";
import { formatFrequency } from "@/lib/bill-utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { BillForm } from "@/components/bills/bill-form";
import {
  useBillsQuery,
  useCreateBill,
  useUpdateBill,
  useDeleteBill,
  useBillHistoryQuery,
} from "@/hooks/use-bills";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import type { ScheduledTransactionInput } from "@/lib/validations";
import type { ScheduledTransactionWithCategory } from "@/types";

const formatShortDate = (date: Date | string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));

const STATUS_COLORS = {
  PAID: "bg-income-light text-income",
  SKIPPED: "bg-cream-200 text-warm-500",
  SNOOZED: "bg-amber-light text-amber-dark",
};

export default function BillsPage() {
  const [filter, setFilter] = useState<"active" | "inactive">("active");
  const [showForm, setShowForm] = useState(false);
  const [editingBill, setEditingBill] = useState<ScheduledTransactionWithCategory | null>(null);
  const [deletingBill, setDeletingBill] = useState<ScheduledTransactionWithCategory | null>(null);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);

  const { hideAmounts } = usePrivacy();
  const { user } = useUser();

  const isActive = filter === "active";
  const { data: bills = [], isLoading } = useBillsQuery({ active: isActive });

  const createBill = useCreateBill();
  const updateBill = useUpdateBill();
  const deleteBill = useDeleteBill();

  const handleCreate = async (input: ScheduledTransactionInput) => {
    await createBill.mutateAsync(input);
    setShowForm(false);
  };

  const handleUpdate = async (input: ScheduledTransactionInput) => {
    if (!editingBill) return;
    await updateBill.mutateAsync({ id: editingBill.id, input });
    setEditingBill(null);
  };

  const handleDelete = () => {
    if (!deletingBill) return;
    deleteBill.mutate(deletingBill.id, {
      onSuccess: () => setDeletingBill(null),
    });
  };

  const getDueDateLabel = (bill: ScheduledTransactionWithCategory) => {
    const due = new Date(bill.nextDueDate);
    due.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { text: `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"} overdue`, isOverdue: true };
    if (diffDays === 0) return { text: "Due today", isOverdue: false };
    if (diffDays === 1) return { text: "Due tomorrow", isOverdue: false };
    return { text: `Due ${formatShortDate(due)}`, isOverdue: false };
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-2xl lg:text-3xl text-warm-700">
            Bills
          </h1>
          <p className="text-warm-400 text-sm mt-1">
            Manage your recurring bills and subscriptions.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="hidden sm:inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium text-sm px-5 py-2.5 rounded-xl transition-colors shadow-soft hover:shadow-soft-md"
        >
          <Plus className="w-4 h-4" />
          New Bill
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-1 p-0.5 bg-cream-200/60 rounded-lg w-fit mb-6">
        {(["active", "inactive"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={cn(
              "px-4 py-2 rounded-md text-xs font-medium transition-all duration-150",
              filter === status
                ? "bg-white text-warm-700 shadow-warm"
                : "text-warm-400 hover:text-warm-600"
            )}
          >
            {status === "active" ? "Active" : "Inactive"}
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl animate-shimmer" />
                <div className="flex-1 space-y-2">
                  <div className="w-32 h-4 rounded animate-shimmer" />
                  <div className="w-20 h-3 rounded animate-shimmer" />
                </div>
                <div className="w-20 h-5 rounded animate-shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : bills.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={isActive ? "No active bills" : "No inactive bills"}
          description={
            isActive
              ? "Add your recurring bills to get reminders when they're due."
              : "Deactivated bills will appear here."
          }
          action={
            isActive ? (
              <button
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-soft"
              >
                <Plus className="w-4 h-4" />
                Add Bill
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {bills.map((bill) => {
              const dueLabel = getDueDateLabel(bill);
              const isExpanded = expandedBillId === bill.id;

              return (
                <motion.div
                  key={bill.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="card-hover group"
                >
                  <div className="p-4">
                    <div className="flex items-center gap-3">
                      {/* Category icon */}
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: bill.category.color + "18" }}
                      >
                        <CategoryIcon
                          name={bill.category.icon}
                          className="w-5 h-5"
                          style={{ color: bill.category.color }}
                        />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-warm-600 truncate">
                            {bill.description || bill.category.name}
                          </p>
                          <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cream-200 text-warm-500">
                            {formatFrequency(bill.frequency, bill.customIntervalDays)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={cn(
                            "text-xs font-medium",
                            dueLabel.isOverdue ? "text-expense" : "text-warm-400"
                          )}>
                            {dueLabel.text}
                          </span>
                          {bill.reminderDaysBefore > 0 && (
                            <span className="text-[10px] text-warm-300">
                              &middot; Reminds {bill.reminderDaysBefore}d before
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Amount */}
                      <span className={cn(
                        "text-sm font-semibold tabular-nums shrink-0",
                        bill.type === "INCOME" ? "text-income" : "text-expense"
                      )}>
                        {hideAmounts ? "***" : formatCurrency(bill.amount, user.currency)}
                      </span>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setEditingBill(bill)}
                          className="p-1.5 rounded-lg text-warm-300 hover:text-amber hover:bg-amber-light transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeletingBill(bill)}
                          className="p-1.5 rounded-lg text-warm-300 hover:text-expense hover:bg-expense-light transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expand/collapse history */}
                  <button
                    onClick={() => setExpandedBillId(isExpanded ? null : bill.id)}
                    className="w-full flex items-center justify-center gap-1 py-1.5 border-t border-cream-200/60 text-[10px] text-warm-300 hover:text-warm-500 transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {isExpanded ? "Hide" : "History"}
                  </button>

                  {/* Inline history */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <BillHistory billId={bill.id} currency={user.currency} hideAmounts={hideAmounts} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Create Bill Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New Bill"
      >
        <BillForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      {/* Edit Bill Modal */}
      <Modal
        open={!!editingBill}
        onClose={() => setEditingBill(null)}
        title="Edit Bill"
      >
        {editingBill && (
          <BillForm
            bill={editingBill}
            onSubmit={handleUpdate}
            onCancel={() => setEditingBill(null)}
          />
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deletingBill}
        onClose={() => setDeletingBill(null)}
        title="Deactivate Bill"
      >
        <p className="text-warm-500 text-sm mb-2">
          Are you sure you want to deactivate{" "}
          <span className="font-medium text-warm-700">
            &ldquo;{deletingBill?.description || deletingBill?.category.name}&rdquo;
          </span>
          ?
        </p>
        <p className="text-warm-400 text-xs mb-6">
          The bill will be deactivated and no longer trigger reminders. Payment history is preserved.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeletingBill(null)}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteBill.isPending}
            className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-expense hover:bg-expense-dark text-white font-medium text-sm transition-colors disabled:opacity-50"
          >
            {deleteBill.isPending ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Deactivate
              </>
            )}
          </button>
        </div>
      </Modal>

      {/* Mobile FAB */}
      <button
        onClick={() => setShowForm(true)}
        className="sm:hidden fixed bottom-20 right-4 z-20 inline-flex items-center gap-1.5 px-4 py-3 rounded-full bg-amber hover:bg-amber-dark text-white font-medium text-sm shadow-soft-lg active:scale-95 transition-all"
      >
        <Plus className="w-4 h-4" />
        Bill
      </button>
    </div>
  );
}

/** Inline bill payment history */
function BillHistory({ billId, currency, hideAmounts }: { billId: string; currency: string; hideAmounts: boolean }) {
  const { data, isLoading } = useBillHistoryQuery(billId);

  if (isLoading) {
    return (
      <div className="px-4 pb-3 space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-16 h-3 rounded animate-shimmer" />
            <div className="w-12 h-3 rounded animate-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (!data?.logs.length) {
    return (
      <div className="px-4 pb-3">
        <p className="text-xs text-warm-300 text-center py-2">No payment history yet</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-3 space-y-1.5">
      {data.logs.map((log) => (
        <div key={log.id} className="flex items-center gap-3 text-xs">
          <span className="text-warm-400 tabular-nums w-24 shrink-0">
            {formatShortDate(log.dueDate)}
          </span>
          <span className={cn(
            "px-2 py-0.5 rounded-full text-[10px] font-medium",
            STATUS_COLORS[log.status]
          )}>
            {log.status.charAt(0) + log.status.slice(1).toLowerCase()}
          </span>
          {log.transactionId && !hideAmounts && (
            <span className="text-warm-400 ml-auto">
              {formatCurrency(0, currency).replace(/[\d,.]+/, "...")}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
