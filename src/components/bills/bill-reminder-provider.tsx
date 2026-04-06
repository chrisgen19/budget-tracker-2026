"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { usePendingRemindersQuery, useBillAction } from "@/hooks/use-bills";
import { useToast } from "@/components/ui/toast";
import type { PendingReminder } from "@/types";

interface BillReminderContextValue {
  pendingReminders: PendingReminder[];
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  handlePay: (reminder: PendingReminder) => void;
  handleSnooze: (reminder: PendingReminder, snoozeDays?: number) => void;
  handleSkip: (reminder: PendingReminder) => void;
  handlePayAll: () => void;
  isActioning: boolean;
  payAllProgress: { current: number; total: number } | null;
  bannerHeight: number;
  setBannerHeight: (height: number) => void;
}

const BillReminderContext = createContext<BillReminderContextValue>({
  pendingReminders: [],
  currentIndex: 0,
  setCurrentIndex: () => {},
  handlePay: () => {},
  handleSnooze: () => {},
  handleSkip: () => {},
  handlePayAll: () => {},
  isActioning: false,
  payAllProgress: null,
  bannerHeight: 0,
  setBannerHeight: () => {},
});

export const useBillReminders = () => useContext(BillReminderContext);

export function BillReminderProvider({ children }: { children: React.ReactNode }) {
  const { data: pendingReminders = [] } = usePendingRemindersQuery();
  const billAction = useBillAction();
  const { showToast } = useToast();
  const [currentIndex, setCurrentIndex] = useState(0);

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

  const handleSnooze = useCallback((reminder: PendingReminder, snoozeDays?: number) => {
    const days = snoozeDays ?? 1;
    billAction.mutate(
      {
        id: reminder.scheduledTransaction.id,
        input: { action: "snooze", dueDate: reminder.dueDate, snoozeDays: days },
      },
      {
        onSuccess: () => {
          showToast(`${getBillLabel(reminder)} snoozed for ${days} day${days > 1 ? "s" : ""}`);
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

  const [bannerHeight, setBannerHeightRaw] = useState(0);
  const setBannerHeight = useCallback((h: number) => setBannerHeightRaw(h), []);
  const [payAllProgress, setPayAllProgress] = useState<{ current: number; total: number } | null>(null);

  const handlePayAll = useCallback(async () => {
    if (pendingReminders.length === 0) return;
    const total = pendingReminders.length;
    setPayAllProgress({ current: 0, total });

    // Copy reminders since the array will mutate as payments process
    const remindersSnapshot = [...pendingReminders];
    let succeeded = 0;
    let failed = 0;

    for (const reminder of remindersSnapshot) {
      try {
        await new Promise<void>((resolve, reject) => {
          billAction.mutate(
            {
              id: reminder.scheduledTransaction.id,
              input: { action: "pay", dueDate: reminder.dueDate },
            },
            {
              onSuccess: () => {
                succeeded++;
                setPayAllProgress({ current: succeeded + failed, total });
                resolve();
              },
              onError: (err) => reject(err),
            },
          );
        });
      } catch {
        // Continue paying remaining bills even if one fails
        failed++;
        setPayAllProgress({ current: succeeded + failed, total });
      }
    }

    if (failed === 0) {
      showToast(`${succeeded} bill${succeeded > 1 ? "s" : ""} paid`);
    } else if (succeeded === 0) {
      showToast(`All ${failed} bill${failed > 1 ? "s" : ""} failed`);
    } else {
      showToast(`${succeeded} paid, ${failed} failed`);
    }
    setPayAllProgress(null);
    setCurrentIndex(0);
  }, [pendingReminders, billAction, showToast]);

  return (
    <BillReminderContext.Provider
      value={{
        pendingReminders,
        currentIndex: safeIndex,
        setCurrentIndex,
        handlePay,
        handleSnooze,
        handleSkip,
        handlePayAll,
        isActioning: billAction.isPending,
        payAllProgress,
        bannerHeight,
        setBannerHeight,
      }}
    >
      {children}
    </BillReminderContext.Provider>
  );
}
