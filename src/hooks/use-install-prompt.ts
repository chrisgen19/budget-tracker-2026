"use client";

import { useState, useEffect, useCallback } from "react";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /**
     * Set by the inline capture script in the root layout. Chrome fires
     * `beforeinstallprompt` once, shortly after load and often before React has
     * hydrated — the event never replays, so it is stashed here at parse time.
     */
    __bipEvent?: BeforeInstallPromptEvent | null;
  }
}

/** Chrome throws if `prompt()` is called twice, so a consumed event must not linger. */
const clearStashedPrompt = () => {
  window.__bipEvent = null;
};

function isRunningStandalone() {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS before 16.4 reports display-mode incorrectly; navigator.standalone is
  // the only reliable signal inside a home-screen PWA there.
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (isRunningStandalone()) {
      setIsInstalled(true);
      return;
    }

    // Adopt an event the inline capture script caught before hydration
    if (window.__bipEvent) {
      setDeferredPrompt(window.__bipEvent);
    }

    const handleStashed = () => {
      if (window.__bipEvent) setDeferredPrompt(window.__bipEvent);
    };

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      clearStashedPrompt();
    };

    window.addEventListener("bip-ready", handleStashed);
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("bip-ready", handleStashed);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    // Drop the reference first — the event is spent the moment prompt() runs,
    // so a second caller must not be able to reuse it.
    setDeferredPrompt(null);
    clearStashedPrompt();
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    return outcome === "accepted";
  }, [deferredPrompt]);

  return {
    canInstall: !!deferredPrompt && !isInstalled,
    isInstalled,
    promptInstall,
  };
}
