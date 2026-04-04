"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clock, FastForward, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatCurrency, cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { useToast } from "@/components/ui/toast";
import { useBillAction, type UpcomingBill } from "@/hooks/use-bills";

interface UpcomingBillRowProps {
  bill: UpcomingBill;
  currency: string;
  hideAmounts: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onActionComplete: () => void;
}

const SNOOZE_OPTIONS = [
  { label: "1 day", days: 1 },
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
] as const;

export function UpcomingBillRow({
  bill,
  currency,
  hideAmounts,
  isExpanded,
  onToggleExpand,
  onActionComplete,
}: UpcomingBillRowProps) {
  const billAction = useBillAction();
  const { showToast } = useToast();
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);

  const isActioning = billAction.isPending;

  // Close snooze menu on outside click
  useEffect(() => {
    if (!showSnoozeMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) {
        setShowSnoozeMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSnoozeMenu]);

  // Close snooze menu when row collapses
  useEffect(() => {
    if (!isExpanded) setShowSnoozeMenu(false);
  }, [isExpanded]);

  const days = bill.daysUntilDue;
  const dueLabel = bill.isOverdue
    ? `${Math.abs(days)}d overdue`
    : days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : `In ${days}d`;

  const handlePay = () => {
    billAction.mutate(
      { id: bill.id, input: { action: "pay", dueDate: bill.dueDate } },
      {
        onSuccess: () => {
          showToast(`${bill.description} paid`);
          onActionComplete();
        },
        onError: () => {
          showToast("Failed to pay bill", "error");
        },
      },
    );
  };

  const handleSkip = () => {
    billAction.mutate(
      { id: bill.id, input: { action: "skip", dueDate: bill.dueDate } },
      {
        onSuccess: () => {
          showToast(`${bill.description} skipped`);
          onActionComplete();
        },
        onError: () => {
          showToast("Failed to skip bill", "error");
        },
      },
    );
  };

  const handleSnooze = (snoozeDays: number) => {
    billAction.mutate(
      { id: bill.id, input: { action: "snooze", dueDate: bill.dueDate, snoozeDays } },
      {
        onSuccess: () => {
          showToast(`${bill.description} snoozed for ${snoozeDays} day${snoozeDays > 1 ? "s" : ""}`);
          setShowSnoozeMenu(false);
          onActionComplete();
        },
        onError: () => {
          showToast("Failed to snooze bill", "error");
        },
      },
    );
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Clickable row */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        className="flex items-center gap-3 w-full text-left rounded-lg px-1.5 py-1 -mx-1.5 transition-colors hover:bg-cream-50 cursor-pointer"
      >
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
          bill.isOverdue ? "text-expense" : "text-warm-400",
        )}>
          {dueLabel}
        </span>
        <span className="text-sm font-semibold tabular-nums text-warm-600 shrink-0">
          {hideAmounts ? "***" : formatCurrency(bill.amount, currency)}
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-warm-300 shrink-0 transition-transform duration-200",
            isExpanded && "rotate-180",
          )}
        />
      </div>

      {/* Expandable action bar */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 pt-2 pl-10">
              {/* Pay */}
              <button
                onClick={handlePay}
                disabled={isActioning}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-income/10 text-income hover:bg-income/20 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <Check className="w-3 h-3" />
                Pay
              </button>

              {/* Snooze dropdown */}
              <div className="relative" ref={snoozeRef}>
                <button
                  onClick={() => setShowSnoozeMenu((prev) => !prev)}
                  disabled={isActioning}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cream-100 text-warm-500 hover:bg-cream-200 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <Clock className="w-3 h-3" />
                  Snooze
                  <ChevronDown className={cn("w-3 h-3 transition-transform", showSnoozeMenu ? "rotate-180" : "")} />
                </button>
                <AnimatePresence>
                  {showSnoozeMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      className="absolute top-full mt-1 left-0 bg-white rounded-lg shadow-soft-lg border border-cream-200 overflow-hidden min-w-[120px] z-30"
                    >
                      {SNOOZE_OPTIONS.map((option) => (
                        <button
                          key={option.days}
                          onClick={() => handleSnooze(option.days)}
                          disabled={isActioning}
                          className="w-full text-left px-3 py-2 text-xs text-warm-600 hover:bg-cream-100 transition-colors disabled:opacity-50"
                        >
                          {option.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Skip */}
              <button
                onClick={handleSkip}
                disabled={isActioning}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cream-100 text-warm-400 hover:bg-cream-200 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <FastForward className="w-3 h-3" />
                Skip
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
