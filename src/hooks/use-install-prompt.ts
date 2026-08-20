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
     * hydrated. The event never replays, so it is stashed here at parse time.
     */
    __bipEvent?: BeforeInstallPromptEvent | null;
  }
}

/**
 * Chrome throws if `prompt()` is called twice, so a consumed event must not
 * linger. Several components use this hook at once (the banner and the profile
 * card are both mounted on /profile) and each holds its own copy of the event,
 * so clearing the stash alone is not enough: every instance has to be told.
 */
const CONSUMED_EVENT = "bip-consumed";

const clearStashedPrompt = () => {
  window.__bipEvent = null;
  window.dispatchEvent(new Event(CONSUMED_EVENT));
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

    // Another instance claimed the event; ours is now spent
    const handleConsumed = () => setDeferredPrompt(null);

    window.addEventListener(CONSUMED_EVENT, handleConsumed);
    window.addEventListener("bip-ready", handleStashed);
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(CONSUMED_EVENT, handleConsumed);
      window.removeEventListener("bip-ready", handleStashed);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    // Claim the event before prompting so no other instance can reuse it, and
    // so every entry point stops offering an install that would now throw.
    clearStashedPrompt();
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      return outcome === "accepted";
    } catch {
      // Already consumed, or the browser refused to show the dialog
      return false;
    }
  }, [deferredPrompt]);

  return {
    canInstall: !!deferredPrompt && !isInstalled,
    isInstalled,
    promptInstall,
  };
}
