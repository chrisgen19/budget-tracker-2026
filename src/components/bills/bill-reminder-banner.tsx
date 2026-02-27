"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Check, Clock, FastForward, Pencil } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { useBillReminders } from "@/components/bills/bill-reminder-provider";

const formatDueDateDisplay = (dateStr: string) => {
  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  if (diffDays === -1) return "1 day overdue";
  if (diffDays < 0) return `${Math.abs(diffDays)} days overdue`;
  return `Due in ${diffDays} days`;
};

interface BillReminderBannerProps {
  onPayAndEdit: (data: {
    amount: number;
    description: string;
    type: "INCOME" | "EXPENSE";
    date: string;
    categoryId: string;
  }) => void;
}

export function BillReminderBanner({ onPayAndEdit }: BillReminderBannerProps) {
  const {
    pendingReminders,
    currentIndex,
    setCurrentIndex,
    handlePay,
    handleSnooze,
    handleSkip,
    isActioning,
  } = useBillReminders();

  const { hideAmounts } = usePrivacy();
  const { user } = useUser();

  if (pendingReminders.length === 0) return null;

  const reminder = pendingReminders[currentIndex];
  if (!reminder) return null;

  const { scheduledTransaction: bill, isOverdue, daysPastDue } = reminder;
  const dueDateDisplay = formatDueDateDisplay(reminder.dueDate);

  const handlePayAndEditClick = () => {
    // Format dueDate to datetime-local format for the transaction form
    const dueDate = new Date(reminder.dueDate);
    const year = dueDate.getFullYear();
    const month = String(dueDate.getMonth() + 1).padStart(2, "0");
    const day = String(dueDate.getDate()).padStart(2, "0");
    const hours = String(new Date().getHours()).padStart(2, "0");
    const minutes = String(new Date().getMinutes()).padStart(2, "0");

    onPayAndEdit({
      amount: bill.amount,
      description: bill.description,
      type: bill.type,
      date: `${year}-${month}-${day}T${hours}:${minutes}`,
      categoryId: bill.categoryId,
    });
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed bottom-20 lg:bottom-4 left-4 right-4 lg:left-68 z-20"
      >
        <div className="bg-white rounded-2xl shadow-soft-lg border border-cream-300/60 overflow-hidden max-w-xl mx-auto lg:mx-0">
          {/* Header row */}
          <div className="flex items-center gap-3 px-4 pt-3 pb-2">
            {/* Category icon */}
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: bill.category.color + "18" }}
            >
              <CategoryIcon
                name={bill.category.icon}
                className="w-4 h-4"
                style={{ color: bill.category.color }}
              />
            </div>

            {/* Description + amount */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-warm-700 truncate">
                {bill.description || bill.category.name}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn(
                  "text-xs font-medium",
                  isOverdue ? "text-expense" : "text-warm-400"
                )}>
                  {dueDateDisplay}
                </span>
                {isOverdue && daysPastDue > 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-expense-light text-expense">
                    OVERDUE
                  </span>
                )}
              </div>
            </div>

            {/* Amount */}
            <span className={cn(
              "text-base font-bold tabular-nums shrink-0",
              bill.type === "INCOME" ? "text-income" : "text-expense"
            )}>
              {hideAmounts ? "***" : formatCurrency(bill.amount, user.currency)}
            </span>
          </div>

          {/* Actions row */}
          <div className="flex items-center gap-1.5 px-3 pb-3">
            {/* Navigation */}
            {pendingReminders.length > 1 && (
              <div className="flex items-center gap-1 mr-1">
                <button
                  onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                  className="p-1 rounded-lg text-warm-300 hover:text-warm-600 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[10px] text-warm-400 tabular-nums min-w-[32px] text-center">
                  {currentIndex + 1}/{pendingReminders.length}
                </span>
                <button
                  onClick={() => setCurrentIndex(Math.min(pendingReminders.length - 1, currentIndex + 1))}
                  disabled={currentIndex === pendingReminders.length - 1}
                  className="p-1 rounded-lg text-warm-300 hover:text-warm-600 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                onClick={() => handlePay(reminder)}
                disabled={isActioning}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-income/10 text-income hover:bg-income/20 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <Check className="w-3 h-3" />
                Pay
              </button>
              <button
                onClick={handlePayAndEditClick}
                disabled={isActioning}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-light text-amber-dark hover:bg-amber/20 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
              <button
                onClick={() => handleSnooze(reminder)}
                disabled={isActioning}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cream-100 text-warm-500 hover:bg-cream-200 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <Clock className="w-3 h-3" />
                Skip
              </button>
              <button
                onClick={() => handleSkip(reminder)}
                disabled={isActioning}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cream-100 text-warm-400 hover:bg-cream-200 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <FastForward className="w-3 h-3" />
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
