"use client";

import { createContext, useContext, useState, useCallback } from "react";

interface InstallBannerContextValue {
  bannerVisible: boolean;
  setBannerVisible: (visible: boolean) => void;
}

const InstallBannerContext = createContext<InstallBannerContextValue>({
  bannerVisible: false,
  setBannerVisible: () => {},
});

export function InstallBannerProvider({ children }: { children: React.ReactNode }) {
  const [bannerVisible, setBannerVisibleRaw] = useState(false);
  const setBannerVisible = useCallback((v: boolean) => setBannerVisibleRaw(v), []);

  return (
    <InstallBannerContext.Provider value={{ bannerVisible, setBannerVisible }}>
      {children}
    </InstallBannerContext.Provider>
  );
}

export function useInstallBanner() {
  return useContext(InstallBannerContext);
}
