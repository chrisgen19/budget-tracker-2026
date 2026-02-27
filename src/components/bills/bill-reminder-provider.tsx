"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { usePendingRemindersQuery, useBillAction } from "@/hooks/use-bills";
import { useToast } from "@/components/ui/toast";
import type { PendingReminder } from "@/types";
import type { InitialTransactionData } from "@/components/transactions/transaction-form";

interface BillReminderContextValue {
  pendingReminders: PendingReminder[];
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  handlePay: (reminder: PendingReminder) => void;
  handleSnooze: (reminder: PendingReminder) => void;
  handleSkip: (reminder: PendingReminder) => void;
  isActioning: boolean;
  /** Set when "Pay & Edit" is clicked — AppShell reads this to open TransactionForm */
  payAndEditData: InitialTransactionData | null;
  clearPayAndEditData: () => void;
}

const BillReminderContext = createContext<BillReminderContextValue>({
  pendingReminders: [],
  currentIndex: 0,
  setCurrentIndex: () => {},
  handlePay: () => {},
  handleSnooze: () => {},
  handleSkip: () => {},
  isActioning: false,
  payAndEditData: null,
  clearPayAndEditData: () => {},
});

export const useBillReminders = () => useContext(BillReminderContext);

export function BillReminderProvider({ children }: { children: React.ReactNode }) {
  const { data: pendingReminders = [] } = usePendingRemindersQuery();
  const billAction = useBillAction();
  const { showToast } = useToast();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [payAndEditData, setPayAndEditData] = useState<InitialTransactionData | null>(null);

  // Keep index in bounds when reminders change
  const safeIndex = pendingReminders.length > 0
    ? Math.min(currentIndex, pendingReminders.length - 1)
    : 0;

  const getBillLabel = (reminder: PendingReminder) =>
    reminder.scheduledTransaction.description || reminder.scheduledTransaction.category.name;

  const handlePay = useCallback((reminder: PendingReminder) => {
    billAction.mutate(
      {
        id: reminder.scheduledTransaction.id,
        input: { action: "pay", dueDate: reminder.dueDate },
      },
      {
        onSuccess: () => {
          setCurrentIndex((prev) => Math.max(0, prev - 1));
          showToast(`${getBillLabel(reminder)} paid`);
        },
      },
    );
  }, [billAction, showToast]);

  const handleSnooze = useCallback((reminder: PendingReminder) => {
    billAction.mutate(
      {
        id: reminder.scheduledTransaction.id,
        input: { action: "snooze", dueDate: reminder.dueDate },
      },
      {
        onSuccess: () => {
          showToast(`${getBillLabel(reminder)} snoozed until tomorrow`);
        },
      },
    );
  }, [billAction, showToast]);

  const handleSkip = useCallback((reminder: PendingReminder) => {
    billAction.mutate(
      {
        id: reminder.scheduledTransaction.id,
        input: { action: "skip", dueDate: reminder.dueDate },
      },
      {
        onSuccess: () => {
          setCurrentIndex((prev) => Math.max(0, prev - 1));
          showToast(`${getBillLabel(reminder)} skipped`);
        },
      },
    );
  }, [billAction, showToast]);

  const clearPayAndEditData = useCallback(() => {
    setPayAndEditData(null);
  }, []);

  return (
    <BillReminderContext.Provider
      value={{
        pendingReminders,
        currentIndex: safeIndex,
        setCurrentIndex,
        handlePay,
        handleSnooze,
        handleSkip,
        isActioning: billAction.isPending,
        payAndEditData,
        clearPayAndEditData,
      }}
    >
      {children}
    </BillReminderContext.Provider>
  );
}
