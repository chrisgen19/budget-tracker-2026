"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { usePendingRemindersQuery, useBillAction } from "@/hooks/use-bills";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/components/user-provider";
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
  /** True when the user dismissed the banner for the current day. */
  dismissedForToday: boolean;
  /** Hide the banner until the next calendar day (client-side only — does not change any bill). */
  dismissForToday: () => void;
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
  dismissedForToday: false,
  dismissForToday: () => {},
});

export const useBillReminders = () => useContext(BillReminderContext);

/** Per-user storage key so a dismissal doesn't leak across accounts in a shared browser. */
const dismissStorageKey = (email: string) => `bill-reminder-dismissed-date:${email}`;

/** Local calendar date as YYYY-MM-DD (used to scope the dismissal to "today"). */
const getLocalDateKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** True when this user dismissed the banner for the current local day. */
const readDismissed = (email: string) => {
  if (typeof window === "undefined" || !email) return false;
  try {
    return localStorage.getItem(dismissStorageKey(email)) === getLocalDateKey();
  } catch {
    return false;
  }
};

export function BillReminderProvider({ children }: { children: React.ReactNode }) {
  const { data: pendingReminders = [] } = usePendingRemindersQuery();
  const billAction = useBillAction();
  const { user } = useUser();
  const email = user.email;
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

  // Hide the banner for the rest of the day (client-side only). Initialised
  // lazily from localStorage so a refresh keeps it dismissed without a flash.
  const [dismissedForToday, setDismissedForToday] = useState(() => readDismissed(email));

  // Re-evaluate when the account changes and when the tab regains focus, so the
  // banner returns after midnight (or for a different user) without a full reload.
  useEffect(() => {
    const sync = () => setDismissedForToday(readDismissed(email));
    sync();
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", sync);
    };
  }, [email]);

  const dismissForToday = useCallback(() => {
    if (!email) return;
    try {
      localStorage.setItem(dismissStorageKey(email), getLocalDateKey());
    } catch {
      // ignore write failures; still hide for this session
    }
    setDismissedForToday(true);
  }, [email]);
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
        dismissedForToday,
        dismissForToday,
      }}
    >
      {children}
    </BillReminderContext.Provider>
  );
}
