"use client";

import { createContext, useContext, useState, useCallback } from "react";

interface InstallBannerContextValue {
  bannerVisible: boolean;
  setBannerVisible: (visible: boolean) => void;
  bannerHeight: number;
  setBannerHeight: (height: number) => void;
}

const InstallBannerContext = createContext<InstallBannerContextValue>({
  bannerVisible: false,
  setBannerVisible: () => {},
  bannerHeight: 0,
  setBannerHeight: () => {},
});

export function InstallBannerProvider({ children }: { children: React.ReactNode }) {
  const [bannerVisible, setBannerVisibleRaw] = useState(false);
  const [bannerHeight, setBannerHeightRaw] = useState(0);
  const setBannerVisible = useCallback((v: boolean) => {
    setBannerVisibleRaw(v);
    if (!v) setBannerHeightRaw(0);
  }, []);
  const setBannerHeight = useCallback((h: number) => setBannerHeightRaw(h), []);

  return (
    <InstallBannerContext.Provider value={{ bannerVisible, setBannerVisible, bannerHeight, setBannerHeight }}>
      {children}
    </InstallBannerContext.Provider>
  );
}

export function useInstallBanner() {
  return useContext(InstallBannerContext);
}
