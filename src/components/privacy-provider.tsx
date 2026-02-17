"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

interface PrivacyContextValue {
  hideAmounts: boolean;
  toggleHideAmounts: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue>({
  hideAmounts: false,
  toggleHideAmounts: () => {},
});

export const usePrivacy = () => useContext(PrivacyContext);

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [hideAmounts, setHideAmounts] = useState(false);

  useEffect(() => {
    const fetchPreference = async () => {
      const res = await fetch("/api/preferences");
      const data = await res.json();
      setHideAmounts(data.hideAmounts);
    };
    fetchPreference();
  }, []);

  const toggleHideAmounts = useCallback(async () => {
    const newValue = !hideAmounts;
    setHideAmounts(newValue);
    await fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hideAmounts: newValue }),
    });
  }, [hideAmounts]);

  return (
    <PrivacyContext.Provider value={{ hideAmounts, toggleHideAmounts }}>
      {children}
    </PrivacyContext.Provider>
  );
}
