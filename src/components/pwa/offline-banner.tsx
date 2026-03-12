"use client";

import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { motion, AnimatePresence } from "framer-motion";

export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
          className="fixed top-[3.75rem] lg:top-0 inset-x-0 z-50 flex items-center justify-center gap-2 bg-warm-600 text-white text-xs font-medium py-2 px-4"
        >
          <WifiOff className="w-3.5 h-3.5" />
          <span>You&apos;re offline. Some features may be unavailable.</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
