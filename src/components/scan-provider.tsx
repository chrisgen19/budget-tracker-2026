"use client";

import { createContext, useContext } from "react";

interface ScanContextValue {
  openScan: () => void;
  canScan: boolean;
  scanLimitReached: boolean;
  scansRemaining: number | null;
  hasLimit: boolean;
}

const ScanContext = createContext<ScanContextValue | null>(null);

export function ScanProvider({
  value,
  children,
}: {
  value: ScanContextValue;
  children: React.ReactNode;
}) {
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

export function useScan() {
  const ctx = useContext(ScanContext);
  if (!ctx) throw new Error("useScan must be used within ScanProvider");
  return ctx;
}
