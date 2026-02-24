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
}

interface UserContextValue {
  user: UserInfo;
  setUser: (user: Partial<UserInfo>) => void;
}

const UserContext = createContext<UserContextValue>({
  user: { name: "", email: "", currency: "PHP", receiptScanEnabled: false, transactionLayout: "infinite", role: "FREE", roleScanEnabled: false, maxUploadFiles: 10 },
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

  const setUser = useCallback((updated: Partial<UserInfo>) => {
    setUserState((prev) => ({ ...prev, ...updated }));
  }, []);

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
}
