"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Check, Clock, CalendarX, Pencil, ChevronUp, CheckCheck, X } from "lucide-react";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { cn, formatCurrency } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { usePrivacy } from "@/components/privacy-provider";
import { useUser } from "@/components/user-provider";
import { useBillReminders } from "@/components/bills/bill-reminder-provider";
import { formatBillDate } from "@/lib/bill-utils";
import type { PendingReminder } from "@/types";
import {
  BILL_BANNER_BASE_DESKTOP_REM,
  BILL_BANNER_BASE_REM,
} from "@/components/ui/bottom-overlay-clearance";
import { combineAccountDateWithTime } from "@/lib/account-time";

/** Derive display text entirely from server-provided values to stay consistent
 *  with the OVERDUE badge and sort order (avoids client/server timezone mismatch). */
const formatDueDateDisplay = (isOverdue: boolean, daysPastDue: number, daysUntilDue: number) => {
  if (isOverdue) {
    if (daysPastDue === 1) return "1 day overdue";
    return `${daysPastDue} days overdue`;
  }
  if (daysUntilDue === 0) return "Due today";
  if (daysUntilDue === 1) return "Due tomorrow";
  return `Due in ${daysUntilDue} days`;
};

export interface PayAndEditData {
  amount: number;
  description: string;
  type: "INCOME" | "EXPENSE";
  date: string;
  categoryId: string;
  /** Bill info needed to log the payment after transaction is created */
  billId: string;
  billDueDate: string;
}

interface BillReminderBannerProps {
  onPayAndEdit: (data: PayAndEditData) => void;
}

export function BillReminderBanner({ onPayAndEdit }: BillReminderBannerProps) {
  const {
    pendingReminders,
    currentIndex,
    setCurrentIndex,
    handlePay,
    handleSnooze,
    handleSkip,
    handlePayAll,
    isActioning,
    payAllProgress,
    setBannerHeight,
    dismissedForToday,
    dismissForToday,
  } = useBillReminders();

  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [confirmPayAll, setConfirmPayAll] = useState(false);
  // Skipping writes a permanent record asserting the occurrence was not paid, and
  // the button sits beside a dismiss control that writes nothing. Two records
  // of a bill that *had* been paid were produced this way (#221), so the
  // consequence is stated before it is written -- and the dialog names the
  // alternative, which is what neither person had reason to look for.
  const [confirmSkip, setConfirmSkip] = useState<PendingReminder | null>(null);
  const snoozeRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  // Callback ref to measure banner height dynamically via ResizeObserver
  const bannerRef = useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) {
      setBannerHeight(0);
      return;
    }
    if (typeof ResizeObserver === "undefined") {
      setBannerHeight(el.getBoundingClientRect().height);
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
      setBannerHeight(height);
    });
    observer.observe(el);
    observerRef.current = observer;
  }, [setBannerHeight]);

  // Close snooze menu on outside click
  useEffect(() => {
    if (!showSnoozeMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) {
        setShowSnoozeMenu(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSnoozeMenu(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showSnoozeMenu]);

  const { hideAmounts } = usePrivacy();
  const { user } = useUser();

  const visible = pendingReminders.length > 0 && !dismissedForToday;
  const reminder = visible ? pendingReminders[currentIndex] : undefined;
  const bill = reminder?.scheduledTransaction;
  const dueDateDisplay = reminder
    ? formatDueDateDisplay(reminder.isOverdue, reminder.daysPastDue, reminder.daysUntilDue)
    : "";
  // Pay All writes each bill's stored amount, so a variable one is excluded:
  // paying several guesses at once is the same error as paying one, multiplied
  // and less visible. They stay in the banner to be settled individually.
  const payAllReminders = pendingReminders.filter((r) => !r.scheduledTransaction.isVariable);
  const payAllTotal = payAllReminders.reduce((sum, r) => sum + r.scheduledTransaction.amount, 0);

  const handlePayAndEditClick = () => {
    if (!reminder || !bill) return;

    // Take the calendar date straight off the ISO string. Reading local
    // getFullYear/getMonth/getDate shifted the prefilled date back a day for
    // anyone behind UTC.
    const datePart = reminder.dueDate.slice(0, 10);

    onPayAndEdit({
      amount: bill.amount,
      description: bill.description,
      type: bill.type,
      date: combineAccountDateWithTime(datePart, new Date(), user.timezoneOffset),
      categoryId: bill.categoryId,
      billId: bill.id,
      billDueDate: reminder.dueDate,
    });
  };

  return (
    <>
    <AnimatePresence>
      {reminder && bill && (
      <motion.div
        key="bill-reminder-banner"
        ref={bannerRef}
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        style={{
          "--bill-banner-bottom": `${BILL_BANNER_BASE_REM}rem`,
          "--bill-banner-bottom-lg": `${BILL_BANNER_BASE_DESKTOP_REM}rem`,
        } as CSSProperties}
        className="fixed bottom-[calc(var(--bill-banner-bottom)+env(safe-area-inset-bottom))] lg:bottom-[calc(var(--bill-banner-bottom-lg)+env(safe-area-inset-bottom))] left-4 right-4 lg:left-auto lg:right-8 lg:w-auto z-20"
      >
        <div className="bg-white rounded-2xl shadow-soft-lg border border-cream-300/60 overflow-hidden max-w-xl mx-auto">
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
                  reminder.isOverdue ? "text-expense" : "text-warm-400"
                )}>
                  {dueDateDisplay}
                </span>
                {reminder.isOverdue && reminder.daysPastDue > 0 && (
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
              {/* A variable bill's stored amount is a fallback, not what is owed.
                  Stating it here is the same assertion the reminder email was
                  changed to stop making (#217): the in-app banner is a reminder
                  too, and the user has explicitly said this bill varies. */}
              {hideAmounts
                ? "***"
                : bill.isVariable
                  ? "varies"
                  : formatCurrency(bill.amount, user.currency)}
            </span>

            {/* Dismiss for the day */}
            <button
              onClick={dismissForToday}
              aria-label="Dismiss for today"
              title="Dismiss for today"
              className="p-1 -mr-1 rounded-lg text-warm-300 hover:text-warm-600 hover:bg-cream-100 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Actions row */}
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
            {/* Navigation */}
            {pendingReminders.length > 1 && (
              <div className="flex items-center gap-1 mr-1 shrink-0">
                <button
                  onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                  aria-label="Previous bill reminder"
                  className="p-1 rounded-lg text-warm-300 hover:text-warm-600 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span
                  aria-label={`Bill ${currentIndex + 1} of ${pendingReminders.length}`}
                  className="text-[10px] text-warm-400 tabular-nums min-w-[32px] text-center"
                >
                  {currentIndex + 1}/{pendingReminders.length}
                </span>
                <button
                  onClick={() => setCurrentIndex(Math.min(pendingReminders.length - 1, currentIndex + 1))}
                  disabled={currentIndex === pendingReminders.length - 1}
                  aria-label="Next bill reminder"
                  className="p-1 rounded-lg text-warm-300 hover:text-warm-600 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
              {/* Pay All — only when multiple reminders */}
              {payAllReminders.length > 1 && (
                <button
                  onClick={() => setConfirmPayAll(true)}
                  disabled={isActioning || payAllProgress !== null}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-income/10 text-income hover:bg-income/20 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <CheckCheck className="w-3 h-3" />
                  {payAllProgress
                    ? `Paying ${payAllProgress.current}/${payAllProgress.total}...`
                    : `Pay All (${payAllReminders.length})`}
                </button>
              )}
              {/* One-click Pay writes the bill's stored amount. For a variable
                  bill that figure is a forecasting fallback, so a click would
                  put a guess in the ledger -- which the estimator reads back as
                  history. Such a bill goes straight to amount entry instead; the
                  server refuses the bare `pay` either way. */}
              {!bill.isVariable && (
                <button
                  onClick={() => handlePay(reminder)}
                  disabled={isActioning || payAllProgress !== null}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-income/10 text-income hover:bg-income/20 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <Check className="w-3 h-3" />
                  Pay
                </button>
              )}
              <button
                onClick={handlePayAndEditClick}
                disabled={isActioning || payAllProgress !== null}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-light text-amber-dark hover:bg-amber/20 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <Pencil className="w-3 h-3" />
                {bill.isVariable ? "Enter amount" : "Pay & Edit"}
              </button>

              {/* Snooze dropdown */}
              <div className="relative" ref={snoozeRef}>
                <button
                  onClick={() => setShowSnoozeMenu((prev) => !prev)}
                  disabled={isActioning || payAllProgress !== null}
                  aria-haspopup="menu"
                  aria-expanded={showSnoozeMenu}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cream-100 text-warm-500 hover:bg-cream-200 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <Clock className="w-3 h-3" />
                  Snooze
                  <ChevronUp className={cn("w-3 h-3 transition-transform", showSnoozeMenu ? "" : "rotate-180")} />
                </button>
                <AnimatePresence>
                  {showSnoozeMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.15 }}
                      role="menu"
                      className="absolute bottom-full mb-1 right-0 bg-white rounded-lg shadow-soft-lg border border-cream-200 overflow-hidden min-w-[120px] z-30"
                    >
                      {([
                        { label: "1 day", days: 1 },
                        { label: "3 days", days: 3 },
                        { label: "1 week", days: 7 },
                      ] as const).map((option) => (
                        <button
                          key={option.days}
                          role="menuitem"
                          onClick={() => {
                            handleSnooze(reminder, option.days);
                            setShowSnoozeMenu(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-warm-600 hover:bg-cream-100 transition-colors"
                        >
                          {option.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* "Didn't pay", not "Skip": the label now names the record that
                  gets written rather than what happens to the banner. A
                  fast-forward icon said "move past this", which is the ✕ beside
                  it -- that one is temporary and writes nothing. */}
              <button
                onClick={() => setConfirmSkip(reminder)}
                disabled={isActioning || payAllProgress !== null}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cream-100 text-warm-400 hover:bg-cream-200 text-xs font-medium transition-colors disabled:opacity-50 relative before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']"
              >
                <CalendarX className="w-3 h-3" />
                Didn&apos;t pay
              </button>
            </div>
          </div>
        </div>
      </motion.div>
      )}
    </AnimatePresence>

    <ConfirmModal
      open={confirmSkip !== null}
      onClose={() => setConfirmSkip(null)}
      onConfirm={() => {
        const r = confirmSkip;
        setConfirmSkip(null);
        if (r) handleSkip(r);
      }}
      // Names the due date, not "this month": a bill can be DAILY, WEEKLY,
      // ANNUALLY or CUSTOM, and the skip records one occurrence rather than a
      // month. Overstating scope in the dialog meant to prevent a false record
      // is the same class of error as the button that made it necessary.
      title={`Record ${formatBillDate(confirmSkip?.dueDate ?? new Date())} as unpaid?`}
      confirmLabel="Yes, it wasn't paid"
      confirmIcon={CalendarX}
      loading={isActioning}
      message={
        <>
          <span className="block">
            {confirmSkip?.scheduledTransaction.description || "This bill"} will be recorded as
            <strong> not paid</strong> for that date, and the bill moves on to its next due date.
          </span>
          <span className="block mt-2">
            Already paid it outside the app? Use <strong>Pay &amp; Edit</strong> instead, or
            attach the payment later from the bill&apos;s history.
          </span>
        </>
      }
    />

    <ConfirmModal
      open={confirmPayAll}
      onClose={() => setConfirmPayAll(false)}
      onConfirm={() => {
        setConfirmPayAll(false);
        handlePayAll();
      }}
      title={`Pay all ${pendingReminders.length} bills?`}
      confirmLabel="Pay all"
      confirmIcon={CheckCheck}
      loading={payAllProgress !== null}
      message={
        <>
          This creates {pendingReminders.length} transactions
          {hideAmounts ? "" : ` totalling ${formatCurrency(payAllTotal, user.currency)}`} and
          advances every bill to its next due date. It cannot be undone from here.
        </>
      }
    />
    </>
  );
}
