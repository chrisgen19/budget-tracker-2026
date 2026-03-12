"use client";

import { useState, useEffect } from "react";
import { Download, X, Share } from "lucide-react";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "pwa-install-dismissed";
const MIN_VISITS_KEY = "pwa-visit-count";
const MIN_VISITS = 3;

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function InstallPromptBanner() {
  const { canInstall, isInstalled, promptInstall } = useInstallPrompt();
  const [visible, setVisible] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    if (isInstalled) return;

    // Check if user dismissed
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed) return;

    // Increment visit count
    const visits = parseInt(localStorage.getItem(MIN_VISITS_KEY) || "0", 10) + 1;
    localStorage.setItem(MIN_VISITS_KEY, String(visits));

    if (visits < MIN_VISITS) return;

    // Show banner: either native prompt (Android/desktop) or iOS guide
    if (canInstall) {
      setVisible(true);
    } else if (isIOS()) {
      setShowIOSGuide(true);
      setVisible(true);
    }
  }, [canInstall, isInstalled]);

  const handleDismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, "1");
  };

  const handleInstall = async () => {
    await promptInstall();
    // Hide banner regardless of outcome — the deferred prompt is consumed either way
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-6 left-4 right-4 lg:left-auto lg:right-6 lg:w-80 z-40 animate-fade-in-up">
      <div className="bg-white rounded-2xl shadow-soft-md border border-cream-300/50 p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center shrink-0">
            {showIOSGuide ? (
              <Share className="w-5 h-5 text-amber" />
            ) : (
              <Download className="w-5 h-5 text-amber" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-warm-700">
              Install Budget Tracker
            </p>
            <p className="text-xs text-warm-400 mt-0.5">
              {showIOSGuide
                ? "Tap the share button, then \"Add to Home Screen\""
                : "Add to your home screen for quick access"}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss install prompt"
            className="p-1 rounded-lg text-warm-300 hover:text-warm-500 hover:bg-cream-100 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {!showIOSGuide && (
          <button
            onClick={handleInstall}
            className={cn(
              "w-full mt-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors",
              "bg-amber text-white hover:bg-amber/90 shadow-soft"
            )}
          >
            Install App
          </button>
        )}
      </div>
    </div>
  );
}
