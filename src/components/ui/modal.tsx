"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

/** Returns true when viewport width < 640px (Tailwind `sm` breakpoint) */
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    setIsMobile(mql.matches);

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isMobile;
};

/**
 * Tracks the visual viewport on iOS Safari so the modal can resize
 * and reposition when the virtual keyboard opens/closes.
 * offsetTop accounts for Safari scrolling the page when an input is focused.
 */
interface VisualViewport {
  height: number;
  offsetTop: number;
}

const useVisualViewport = (enabled: boolean) => {
  const [viewport, setViewport] = useState<VisualViewport | null>(null);

  const update = useCallback(() => {
    const vv = window.visualViewport;
    if (vv) {
      setViewport({ height: vv.height, offsetTop: vv.offsetTop });
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setViewport(null);
      return;
    }

    const vv = window.visualViewport;
    if (!vv) return;

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled, update]);

  return viewport;
};

const desktopVariants = {
  initial: { opacity: 0, scale: 0.95, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 10 },
};

const mobileVariants = {
  initial: { y: "100%" },
  animate: { y: 0 },
  exit: { y: "100%" },
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const isMobile = useIsMobile();
  const viewport = useVisualViewport(isMobile && open);

  // Keep ref in sync so the effect doesn't re-run on every render
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  // On mobile, pin the container to the visual viewport so Safari's
  // scroll-to-focused-input doesn't push the modal off-screen
  const containerStyle = viewport
    ? { top: `${viewport.offsetTop}px`, height: `${viewport.height}px`, bottom: "auto" as const }
    : undefined;

  const mobileMaxHeight = viewport
    ? `${viewport.height * 0.9}px`
    : "90vh";

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
          style={containerStyle}
        >
          {/* Overlay */}
          <motion.div
            ref={overlayRef}
            className="absolute inset-0 bg-warm-900/30 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal Card */}
          <motion.div
            className={cn(
              "relative bg-white shadow-soft-lg w-full grain-overlay flex flex-col",
              isMobile
                ? "rounded-t-2xl"
                : "rounded-2xl max-w-lg max-h-[85vh]"
            )}
            style={isMobile ? { maxHeight: mobileMaxHeight } : undefined}
            variants={isMobile ? mobileVariants : desktopVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={
              isMobile
                ? { type: "spring", damping: 30, stiffness: 300 }
                : { type: "spring", duration: 0.3 }
            }
            // Drag-to-dismiss on mobile
            {...(isMobile && {
              drag: "y" as const,
              dragConstraints: { top: 0, bottom: 0 },
              dragElastic: { top: 0, bottom: 0.4 },
              onDragEnd: (
                _: unknown,
                info: { offset: { y: number }; velocity: { y: number } }
              ) => {
                if (info.offset.y > 100 || info.velocity.y > 300) {
                  onClose();
                }
              },
            })}
          >
            {/* Drag Handle (mobile only) */}
            {isMobile && (
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-10 h-1 rounded-full bg-cream-300" />
              </div>
            )}

            {/* Sticky Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-cream-200/80 shrink-0">
              <h2 className="font-serif text-xl text-warm-700">{title}</h2>
              <button
                onClick={onClose}
                className="p-2 -mr-2 rounded-xl text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="p-6 overflow-y-auto flex-1">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
