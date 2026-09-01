"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

import { useToast } from "@/components/ui/toast";
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
  const { showToast } = useToast();

  useEffect(() => {
    const fetchPreference = async () => {
      const res = await fetch("/api/preferences");
      const data = await res.json();
      setHideAmounts(data.hideAmounts);
    };
    fetchPreference();
  }, []);

  /**
   * Toggle hidden amounts, and put it back if the save does not land.
   *
   * This did not check the response at all: the switch flipped, the request went out, and a
   * failure left the UI disagreeing with the database until the next reload - so amounts could
   * read as hidden on a page that would show them again on refresh. Worse than the profile
   * toggles, which at least reverted.
   *
   * Not routed through `useSavePreference` because `hideAmounts` lives in this provider's own
   * state rather than in `UserInfo`, so there is nothing for that hook to apply. Same rule,
   * applied where the state actually is.
   */
  const toggleHideAmounts = useCallback(async () => {
    const newValue = !hideAmounts;
    setHideAmounts(newValue);

    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hideAmounts: newValue }),
      });

      if (!res.ok) {
        setHideAmounts(!newValue);
        showToast("Could not save that. Please try again.", "error");
      }
    } catch {
      setHideAmounts(!newValue);
      showToast("Could not save that. Check your connection.", "error");
    }
  }, [hideAmounts, showToast]);

  return (
    <PrivacyContext.Provider value={{ hideAmounts, toggleHideAmounts }}>
      {children}
    </PrivacyContext.Provider>
  );
}
