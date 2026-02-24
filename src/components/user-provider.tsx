"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { UserRole } from "@prisma/client";

interface UserInfo {
  name: string;
  email: string;
  currency: string;
  receiptScanEnabled: boolean;
  transactionLayout: "infinite" | "pagination";
  role: UserRole;
  roleScanEnabled: boolean;
  maxUploadFiles: number;
  monthlyScanLimit: number;
  scansUsedThisMonth: number;
}

type UserUpdater = Partial<UserInfo> | ((prev: UserInfo) => Partial<UserInfo>);

interface UserContextValue {
  user: UserInfo;
  setUser: (updater: UserUpdater) => void;
}

const UserContext = createContext<UserContextValue>({
  user: { name: "", email: "", currency: "PHP", receiptScanEnabled: false, transactionLayout: "infinite", role: "FREE", roleScanEnabled: false, maxUploadFiles: 10, monthlyScanLimit: 0, scansUsedThisMonth: 0 },
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
