"use client";

import { useState } from "react";
import { Plus, Pencil, PowerOff, CalendarClock, X, ChevronDown, ChevronUp, RotateCcw, ExternalLink, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatCurrency } from "@/lib/utils";
import { describeDueDate, formatBillDate, formatFrequency } from "@/lib/bill-utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { Modal } from "@/components/ui/modal";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { BillForm } from "@/components/bills/bill-form";
import { ActionFab } from "@/components/ui/action-fab";
import {
  useBillsQuery,
  useCreateBill,
  useUpdateBill,
  useDeleteBill,
  useReactivateBill,
  useBillHistoryQuery,
  useBillPaymentCandidatesQuery,
  useBillAction,
} from "@/hooks/use-bills";
import type { BillPaymentCandidate } from "@/hooks/use-bills";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import type { ScheduledTransactionInput } from "@/lib/validations";
import type { ScheduledTransactionWithCategory } from "@/types";

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
  const reactivateBill = useReactivateBill();

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

  // Prefer the server-computed displayNextDueDate, which walks past PAID/SKIPPED logs. Fall back
  // to nextDueDate for safety if the field is missing (older API responses / cached data). The
  // comparison itself lives in bill-utils: a due date is a date-only UTC anchor and "today" is
  // the account's day, neither of which the browser's zone can be asked for.
  const getDueDateLabel = (bill: ScheduledTransactionWithCategory) =>
    describeDueDate(bill.displayNextDueDate ?? bill.nextDueDate, user.timezoneOffset);

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
                        {bill.labels && bill.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {bill.labels.map((bl) => (
                              <span
                                key={bl.id}
                                className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: bl.label.color + "18", color: bl.label.color }}
                              >
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: bl.label.color }} />
                                {bl.label.name}
                              </span>
                            ))}
                          </div>
                        )}
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
                        {!isActive && (
                          <button
                            onClick={() => reactivateBill.mutate(bill.id)}
                            disabled={reactivateBill.isPending}
                            className="p-1.5 rounded-lg text-warm-300 hover:text-income hover:bg-income-light transition-colors disabled:opacity-50"
                            title="Reactivate"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isActive && (
                          <button
                            onClick={() => setEditingBill(bill)}
                            className="p-1.5 rounded-lg text-warm-300 hover:text-amber hover:bg-amber-light transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isActive && (
                          <button
                            onClick={() => setDeletingBill(bill)}
                            className="p-1.5 rounded-lg text-warm-300 hover:text-expense hover:bg-expense-light transition-colors"
                          >
                            <PowerOff className="w-3.5 h-3.5" />
                          </button>
                        )}
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
      <ConfirmModal
        open={!!deletingBill}
        onClose={() => setDeletingBill(null)}
        onConfirm={handleDelete}
        title="Deactivate Bill"
        message={
          <>
            <p>
              Are you sure you want to deactivate{" "}
              <span className="font-medium text-warm-700">
                &ldquo;{deletingBill?.description || deletingBill?.category.name}&rdquo;
              </span>
              ?
            </p>
            <p className="text-warm-400 text-xs mt-2">
              The bill will be deactivated and no longer trigger reminders. Payment history is preserved.
            </p>
          </>
        }
        confirmLabel="Deactivate"
        confirmIcon={PowerOff}
        loading={deleteBill.isPending}
      />

      {/* Mobile FAB */}
      <ActionFab label="Bill" icon={Plus} onClick={() => setShowForm(true)} />
    </div>
  );
}

/** Inline bill payment history */
/**
 * Attach an existing transaction to a skipped occurrence.
 *
 * Lists only unlinked payments of the bill's own type within a fortnight of the
 * due date. Picking one calls `pay_existing`, which since #216 may supersede a
 * skip -- `pay` still may not, because it would create a *second* transaction
 * for a month that already has one.
 */
function LinkPaymentPanel({
  billId,
  dueDate,
  currency,
  hideAmounts,
  onDone,
}: {
  billId: string;
  dueDate: string;
  currency: string;
  hideAmounts: boolean;
  onDone: () => void;
}) {
  const { data, isLoading, isError } = useBillPaymentCandidatesQuery(billId, dueDate);
  const billAction = useBillAction();
  const [error, setError] = useState<string | null>(null);
  // Picking a row only *selects* it. Committing writes a terminal record that
  // nothing in the app could undo before this PR, and a one-click list is far
  // too easy to hit by accident -- a mobile top-up was linked to a water bill
  // that way while this panel was being tried out.
  const [pending, setPending] = useState<BillPaymentCandidate | null>(null);

  const link = async () => {
    if (!pending) return;
    setError(null);
    try {
      await billAction.mutateAsync({
        id: billId,
        input: { action: "pay_existing", dueDate, transactionId: pending.id },
      });
      setPending(null);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link that payment");
    }
  };

  return (
    <div className="mt-1 ml-24 rounded-lg border border-cream-300 bg-cream-100 p-2 space-y-1">
      {isLoading && <p className="text-[11px] text-warm-400 px-1 py-1">Looking for payments…</p>}
      {isError && (
        <p className="text-[11px] text-expense px-1 py-1">Could not load payments.</p>
      )}
      {data && data.candidates.length === 0 && (
        <p className="text-[11px] text-warm-400 px-1 py-1">
          No unlinked {data.categoryName} payment within {data.windowDays} days of this date.
          Add the transaction first, then link it here.
        </p>
      )}
      {data && data.candidates.length > 0 && (
        <p className="text-[10px] text-warm-400 px-1 pb-0.5">
          {data.categoryName} payments near this date &middot;{" "}
          {data.expectedIsEstimate ? "roughly " : "expected "}
          {hideAmounts ? "***" : formatCurrency(data.expectedAmount, currency)}
        </p>
      )}
      {data?.candidates.map((c) => (
        <button
          key={c.id}
          onClick={() => setPending(c)}
          disabled={billAction.isPending}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[11px] hover:bg-cream-200 disabled:opacity-50 transition-colors relative before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']"
        >
          <span className="text-warm-400 tabular-nums shrink-0">
            {formatBillDate(c.localDate)}
          </span>
          <span className="text-warm-600 truncate">{c.description || c.category.name}</span>
          <span className="ml-auto text-warm-500 font-medium tabular-nums shrink-0">
            {hideAmounts ? "***" : formatCurrency(c.amount, currency)}
          </span>
        </button>
      ))}
      {error && <p className="text-[11px] text-expense px-1">{error}</p>}
      <button
        onClick={onDone}
        className="w-full text-[10px] text-warm-400 hover:text-warm-600 py-0.5 transition-colors relative before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']"
      >
        Cancel
      </button>

      <ConfirmModal
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={link}
        loading={billAction.isPending}
        title="Mark this occurrence as paid?"
        confirmLabel="Link payment"
        message={
          pending && (
            <>
              <span className="block">
                {formatBillDate(dueDate)} will be recorded as paid by{" "}
                <strong>{pending.description || pending.category.name}</strong> of{" "}
                {hideAmounts ? "***" : formatCurrency(pending.amount, currency)} on{" "}
                {formatBillDate(pending.localDate)}.
              </span>
              {/* Not shown for a variable bill: it has no single expected figure,
                  so the warning would fire against a correct payment. Meralco
                  ranges 5,300 to 14,126 -- half of those are "a long way from"
                  any one number, and a warning that cries wolf is worse than
                  none, because the next real one gets dismissed too. */}
              {data && !data.expectedIsEstimate &&
                Math.abs(pending.amount - data.expectedAmount) > data.expectedAmount * 0.5 && (
                <span className="block mt-2 text-expense">
                  That is a long way from the{" "}
                  {hideAmounts ? "***" : formatCurrency(data.expectedAmount, currency)} this bill
                  usually costs. Check it is the right payment.
                </span>
              )}
            </>
          )
        }
      />
    </div>
  );
}

function BillHistory({ billId, currency, hideAmounts }: { billId: string; currency: string; hideAmounts: boolean }) {
  const router = useRouter();
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useBillHistoryQuery(billId);
  // Which skipped occurrence, if any, is being corrected. Only one at a time:
  // the panel replaces the row's content, so two open at once would be noise.
  // Keyed by calendar day -- HistoryResponse types dueDate as a Date but it
  // arrives as an ISO string over JSON, which is why formatBillDate takes both.
  const [linkingDueDate, setLinkingDueDate] = useState<string | null>(null);
  const dueKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

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

  const allLogs = data?.pages.flatMap((page) => page.logs) ?? [];

  if (allLogs.length === 0) {
    return (
      <div className="px-4 pb-3">
        <p className="text-xs text-warm-300 text-center py-2">No payment history yet</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-3 space-y-1.5">
      {allLogs.map((log) => (
        <div key={log.id} className="flex items-center gap-3 text-xs">
          <span className="text-warm-400 tabular-nums w-24 shrink-0">
            {formatBillDate(log.dueDate)}
          </span>
          <span className={cn(
            "px-2 py-0.5 rounded-full text-[10px] font-medium",
            STATUS_COLORS[log.status as keyof typeof STATUS_COLORS]
          )}>
            {log.status.charAt(0) + log.status.slice(1).toLowerCase()}
          </span>
          {log.paidAmount != null && (
            <span className="text-warm-500 font-medium ml-auto tabular-nums flex items-center gap-1">
              {hideAmounts ? "***" : formatCurrency(log.paidAmount, currency)}
              {log.transactionId && (
                <button
                  onClick={() => router.push(`/transactions?highlight=${log.transactionId}`)}
                  className="p-0.5 rounded text-warm-300 hover:text-amber transition-colors"
                  title="View transaction"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </span>
          )}
          {/* Skip is what people press when the bill is already paid and they
              want the reminder gone, so a skipped month is often a payment that
              was never attached. This is the only way to say so afterwards. */}
          {log.status === "SKIPPED" && (
            <button
              onClick={() =>
                setLinkingDueDate(
                  linkingDueDate === dueKey(log.dueDate) ? null : dueKey(log.dueDate),
                )
              }
              className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-warm-400 hover:text-amber hover:bg-cream-200 transition-colors relative before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']"
              aria-expanded={linkingDueDate === dueKey(log.dueDate)}
            >
              <Link2 className="w-3 h-3" />
              I paid this
            </button>
          )}
        </div>
      ))}
      {allLogs.some(
        (log) => log.status === "SKIPPED" && linkingDueDate === dueKey(log.dueDate),
      ) && (
        <LinkPaymentPanel
          billId={billId}
          dueDate={linkingDueDate!}
          currency={currency}
          hideAmounts={hideAmounts}
          onDone={() => setLinkingDueDate(null)}
        />
      )}

      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full text-center text-[11px] text-warm-400 hover:text-warm-600 font-medium py-1.5 transition-colors disabled:opacity-50"
        >
          {isFetchingNextPage ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
