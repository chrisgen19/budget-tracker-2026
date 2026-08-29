"use client";

import { useEffect, useId, useRef, useState, useCallback } from "react";
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

/**
 * Body scroll lock, ref-counted across every mounted Modal.
 *
 * Each instance used to snapshot and restore `body.style.overflow` itself. With two modals
 * open (a ConfirmModal over the review sheet), the second snapshots the first's `"hidden"`,
 * and when both close in one commit the cleanups run in tree order -- the outer restores the
 * real value, then the inner restores `"hidden"` over it, leaving the page unscrollable until
 * a reload. Counting makes the restore order-independent: only the last unlock restores.
 */
let scrollLockCount = 0;
let savedOverflow = "";
let savedScrollY = 0;
const modalStack: symbol[] = [];
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const lockBodyScroll = () => {
  if (scrollLockCount === 0) {
    savedScrollY = window.scrollY;
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
};

const unlockBodyScroll = () => {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedOverflow;
    window.scrollTo(0, savedScrollY);
  }
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
  const titleId = useId();
  const modalTokenRef = useRef(Symbol("modal"));
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const isMobile = useIsMobile();
  const viewport = useVisualViewport(isMobile && open);

  // Keep ref in sync so the effect doesn't re-run on every render
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    lockBodyScroll();
    const modalToken = modalTokenRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalStack.push(modalToken);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== modalToken) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true");
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    // Move focus into the modal if no child has autoFocus.
    // Delay slightly so the animation can render the content first.
    const focusTimer = setTimeout(() => {
      const content = contentRef.current;
      if (content && !content.contains(document.activeElement)) {
        content.focus({ preventScroll: true });
      }
    }, 50);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      const stackIndex = modalStack.lastIndexOf(modalToken);
      if (stackIndex !== -1) modalStack.splice(stackIndex, 1);
      unlockBodyScroll();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open]);

  // On mobile, scroll the focused input into view within the modal's
  // scroll container after the keyboard finishes animating
  useEffect(() => {
    if (!open || !isMobile) return;

    const content = contentRef.current;
    if (!content) return;

    let pendingTimer: ReturnType<typeof setTimeout>;

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        // Delay to let the keyboard animation and viewport resize settle
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
          target.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 350);
      }
    };

    content.addEventListener("focusin", handleFocusIn);
    return () => {
      content.removeEventListener("focusin", handleFocusIn);
      clearTimeout(pendingTimer);
    };
  }, [open, isMobile]);

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
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
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
              <h2 id={titleId} className="font-serif text-xl text-warm-700">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={`Close ${title}`}
                className="-mr-2 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-warm-400 transition-colors hover:bg-cream-100 hover:text-warm-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div ref={contentRef} tabIndex={-1} className="p-6 overflow-y-auto flex-1 outline-none">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
