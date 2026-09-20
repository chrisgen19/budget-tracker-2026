"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { UserRole } from "@prisma/client";

export interface UserInfo {
  name: string;
  email: string;
  currency: string;
  timezoneOffset: number;
  receiptScanEnabled: boolean;
  transactionLayout: "infinite" | "pagination";
  transactionAmountAutofocus: boolean;
  defaultLabelType: "EXPENSE" | "INCOME" | "BOTH";
  showDayName: boolean;
  dayNameFormat: "FULL" | "SHORT";
  emailBillReminders: boolean;
  /** Whether this account owns the Telegram bot, and may therefore use the evening prompt. */
  telegramPromptAvailable: boolean;
  telegramDailyPrompt: boolean;
  /** "HH:mm", zero-padded, in this user's own timezone. */
  telegramDailyPromptTime: string;
  emailVerified: boolean;
  role: UserRole;
  roleScanEnabled: boolean;
  maxUploadFiles: number;
  monthlyScanLimit: number;
  scansUsedThisMonth: number;
  /**
   * Whether this user sees credit cards: always for an admin, otherwise per the /admin/settings
   * switch. Hides the UI only; every card route checks the switch again on its own.
   */
  creditCardsEnabled: boolean;
  /** Multiples of a category's typical charge before the Watchlist calls one expense unusual. */
  watchlistOutlierRatio: number;
  /** An absolute figure that is unusual whatever the category's history, or null for ratio only. */
  watchlistLargeAmount: number | null;
  /** Whether possible duplicates are raised as a Watchlist finding. They are detected either way. */
  watchlistDuplicateAlerts: boolean;
}

type UserUpdater = Partial<UserInfo> | ((prev: UserInfo) => Partial<UserInfo>);

interface UserContextValue {
  user: UserInfo;
  setUser: (updater: UserUpdater) => void;
}

const UserContext = createContext<UserContextValue>({
  user: { name: "", email: "", currency: "PHP", timezoneOffset: -480, receiptScanEnabled: false, transactionLayout: "infinite", transactionAmountAutofocus: true, defaultLabelType: "EXPENSE", showDayName: true, dayNameFormat: "SHORT", emailBillReminders: false, telegramPromptAvailable: false, telegramDailyPrompt: false, telegramDailyPromptTime: "20:00", emailVerified: false, role: "FREE", roleScanEnabled: false, maxUploadFiles: 10, monthlyScanLimit: 0, scansUsedThisMonth: 0, creditCardsEnabled: false, watchlistOutlierRatio: 3, watchlistLargeAmount: null, watchlistDuplicateAlerts: true },
  setUser: () => {},
});

export const useUser = () => useContext(UserContext);

export function UserProvider({
  initialUser,
  children,
}: {
  initialUser: UserInfo;
  children: React.ReactNode;
}) {
  const [user, setUserState] = useState<UserInfo>(initialUser);

  const setUser = useCallback((updater: UserUpdater) => {
    setUserState((prev) => {
      const partial = typeof updater === "function" ? updater(prev) : updater;
      return { ...prev, ...partial };
    });
  }, []);

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
}
