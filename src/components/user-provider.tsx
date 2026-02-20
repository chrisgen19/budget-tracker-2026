"use client";

import { createContext, useContext, useState, useCallback } from "react";

interface UserInfo {
  name: string;
  email: string;
}

interface UserContextValue {
  user: UserInfo;
  setUser: (user: UserInfo) => void;
}

const UserContext = createContext<UserContextValue>({
  user: { name: "", email: "" },
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

  const setUser = useCallback((updated: UserInfo) => {
    setUserState(updated);
  }, []);

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
}
