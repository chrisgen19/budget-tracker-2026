"use client";

import { useState, useEffect, useRef } from "react";
import { Download, X, Share } from "lucide-react";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { useInstallBanner } from "@/components/pwa/install-banner-context";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "pwa-install-dismissed-at";
const MIN_VISITS_KEY = "pwa-visit-count";
const MIN_VISITS = 3;
const DISMISS_DAYS = 14;

// navigator.userAgent is deprecated but navigator.userAgentData is not yet
// supported on iOS Safari, so UA sniffing remains the pragmatic choice here.
function isIOS() {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPod/.test(navigator.userAgent)) return true;
  if (/iPad/.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports as Macintosh — detect via multi-touch support
  if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true;
  return false;
}

export function InstallPromptBanner() {
  const { canInstall, isInstalled, promptInstall } = useInstallPrompt();
  const { bannerVisible: visible, setBannerVisible: setVisible, setBannerHeight } = useInstallBanner();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  // Track visits on mount only — not on canInstall/isInstalled changes
  useEffect(() => {
    const visits = parseInt(localStorage.getItem(MIN_VISITS_KEY) || "0", 10) + 1;
    localStorage.setItem(MIN_VISITS_KEY, String(visits));
  }, []);

  // Show banner when conditions are met
  useEffect(() => {
    if (isInstalled) return;

    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const daysSince = (Date.now() - parseInt(dismissedAt, 10)) / (1000 * 60 * 60 * 24);
      if (daysSince < DISMISS_DAYS) return;
      localStorage.removeItem(DISMISS_KEY);
    }

    const visits = parseInt(localStorage.getItem(MIN_VISITS_KEY) || "0", 10);
    if (visits < MIN_VISITS) return;

    if (canInstall) {
      setVisible(true);
    } else if (isIOS()) {
      setShowIOSGuide(true);
      setVisible(true);
    }
  }, [canInstall, isInstalled, setVisible]);

  useEffect(() => {
    if (!visible) return;

    const node = bannerRef.current;
    if (!node) return;

    const updateBannerHeight = () => {
      setBannerHeight(node.offsetHeight);
    };

    updateBannerHeight();

    if (typeof ResizeObserver === "undefined") {
      return () => {
        setBannerHeight(0);
      };
    }

    const observer = new ResizeObserver(() => {
      updateBannerHeight();
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
      setBannerHeight(0);
    };
  }, [visible, setBannerHeight]);

  const handleDismiss = () => {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  };

  const handleInstall = async () => {
    await promptInstall();
    // Hide banner regardless of outcome — the deferred prompt is consumed either way
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div ref={bannerRef} role="status" aria-live="polite" className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-6 left-4 right-4 lg:left-auto lg:right-6 lg:w-80 z-40 animate-fade-in-up">
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
        {showIOSGuide ? (
          <button
            onClick={handleDismiss}
            className={cn(
              "w-full mt-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors",
              "bg-cream-100 text-warm-500 hover:bg-cream-300/50"
            )}
          >
            Got it
          </button>
        ) : (
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
