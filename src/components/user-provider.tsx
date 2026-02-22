"use client";

import { createContext, useContext, useState, useCallback } from "react";

interface UserInfo {
  name: string;
  email: string;
  currency: string;
  receiptScanEnabled: boolean;
}

interface UserContextValue {
  user: UserInfo;
  setUser: (user: Partial<UserInfo>) => void;
}

const UserContext = createContext<UserContextValue>({
  user: { name: "", email: "", currency: "PHP", receiptScanEnabled: false },
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
