"use client";

import { RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useServiceWorkerUpdate } from "@/hooks/use-service-worker-update";
import { useOnlineStatus } from "@/hooks/use-online-status";

/**
 * Offers the reload that closes the client/server skew a deploy opens (#306).
 *
 * A top banner rather than a bottom one on purpose: the bottom of the viewport is a modelled stack
 * (`bottom-overlay-clearance.ts`) holding the bill reminder, the install prompt and the FAB, and a
 * fourth member would have to earn its place in that geometry. This is transient and belongs beside
 * `OfflineBanner`, which is why it takes the same offsets.
 *
 * Hidden while offline, because it shares those offsets with `OfflineBanner` and two banners at one
 * position is a bug rather than a stack. Nothing is lost: the waiting worker stays waiting, and the
 * prompt returns when the connection does.
 */
export function UpdatePromptBanner() {
  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate();
  const isOnline = useOnlineStatus();

  return (
    <AnimatePresence>
      {updateAvailable && isOnline && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
          className="fixed top-[3.75rem] lg:top-0 inset-x-0 z-50 flex items-center justify-center gap-3 bg-amber-dark text-white text-xs font-medium py-2 px-4"
        >
          <span className="flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            A new version is available.
          </span>
          <button
            type="button"
            onClick={applyUpdate}
            // The 44px target is extended with a pseudo-element rather than by growing the bar,
            // the same trade the profile switches make.
            className="relative underline underline-offset-2 font-semibold before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']"
          >
            Reload
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
