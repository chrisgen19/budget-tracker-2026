"use client";

import { useState } from "react";
import { Download, Check, Share } from "lucide-react";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { cn } from "@/lib/utils";

// navigator.userAgent is deprecated but navigator.userAgentData is not yet
// supported on iOS Safari, so UA sniffing remains the pragmatic choice here.
function isIOS() {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPod|iPad/.test(navigator.userAgent)) return true;
  // iPadOS 13+ reports as Macintosh, so detect via multi-touch support
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

/**
 * Install entry point for Profile > Features. The install banner can be
 * dismissed for 14 days, so this is the way back in. It works because the
 * deferred prompt is captured before hydration and kept until consumed.
 */
export function InstallAppCard() {
  const { canInstall, isInstalled, promptInstall } = useInstallPrompt();
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await promptInstall();
    } finally {
      setInstalling(false);
    }
  };

  const description = isInstalled
    ? "You're using the installed app"
    : canInstall
      ? "Add Budget Tracker to your home screen for quick access"
      : isIOS()
        ? 'Tap the share button, then "Add to Home Screen"'
        : "Use your browser menu to install this app";

  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-cream-300 bg-cream-50/50">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
          {isIOS() && !isInstalled && !canInstall ? (
            <Share className="w-5 h-5 text-amber-dark" />
          ) : (
            <Download className="w-5 h-5 text-amber-dark" />
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-warm-600">Install App</p>
          <p className="text-xs text-warm-400">{description}</p>
        </div>
      </div>

      {isInstalled ? (
        <span className="flex items-center gap-1.5 text-xs font-medium text-warm-400 shrink-0">
          <Check className="w-4 h-4" />
          Installed
        </span>
      ) : canInstall ? (
        <button
          type="button"
          disabled={installing}
          onClick={handleInstall}
          className={cn(
            "px-4 py-2 rounded-xl text-sm font-medium transition-colors shrink-0",
            "bg-amber text-white hover:bg-amber-dark disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {installing ? "Installing..." : "Install"}
        </button>
      ) : (
        <span className="text-xs text-warm-400 shrink-0">Not available</span>
      )}
    </div>
  );
}
