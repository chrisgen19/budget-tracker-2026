"use client";

import { useEffect, useId, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useDialogLifecycle } from "@/components/ui/use-dialog-lifecycle";

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
 * How long the virtual keyboard takes to finish animating in. Android's settles in two
 * steps - the key area, then the suggestion/toolbar strip above it - so this is a
 * backstop, not the whole correction.
 */
const KEYBOARD_SETTLE_MS = 350;

/**
 * Keeps the focused field inside the modal's scroll port while the keyboard opens.
 *
 * iOS Safari does this itself: it scrolls the *page* to lift the focused field clear of
 * the keyboard and reports the shift as `visualViewport.offsetTop`, which
 * `useVisualViewport` above already compensates for. Android Chrome does not - under the
 * default `interactive-widget: resizes-visual` the layout viewport never changes, so as
 * far as Chrome is concerned nothing moved and nothing needs scrolling. The modal only
 * lifts above the keyboard because *we* resize its container from the `visualViewport`
 * resize event, and shrinking a scroll port does not move its `scrollTop`: whatever sat
 * below the new fold stays below it. That is the whole of the Android bug - the amount
 * field is still there, one scroll down, behind the keyboard the user is typing into.
 *
 * So the correction has to be driven by the resize, not by a timer:
 *
 * - on every `visualViewport` resize, because Android reports the keyboard's height more
 *   than once as it and its toolbar strip animate in, and each report shrinks the modal
 *   again under a scroll position that was correct a moment earlier. A single 350ms timer
 *   fires between the two and is undone by the second.
 * - once when the effect attaches, because `autoFocus` (the amount field on a new
 *   transaction) focuses during React's commit phase - before this listener exists - so
 *   `focusin` never fires for it and the old code corrected nothing at all.
 */
const useKeepFocusedFieldVisible = (
  active: boolean,
  contentRef: React.RefObject<HTMLDivElement | null>,
) => {
  useEffect(() => {
    if (!active) return;

    const content = contentRef.current;
    if (!content) return;

    let frame = 0;
    let settleTimer: ReturnType<typeof setTimeout>;

    const revealFocusedField = (behavior: ScrollBehavior) => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || !content.contains(focused)) return;
      focused.scrollIntoView({ block: "center", behavior });
    };

    /**
     * One frame late, so the `visualViewport` resize that triggered this has been through
     * React and the container is already its new height. A jump rather than a smooth
     * scroll: a second resize mid-animation cancels a smooth one and leaves the field
     * wherever it had got to.
     */
    const revealAfterReflow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => revealFocusedField("auto"));
    };

    const handleFocusIn = () => {
      revealAfterReflow();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => revealFocusedField("smooth"), KEYBOARD_SETTLE_MS);
    };

    content.addEventListener("focusin", handleFocusIn);
    window.visualViewport?.addEventListener("resize", revealAfterReflow);

    // Catches a field `autoFocus` focused before this effect ran.
    handleFocusIn();

    return () => {
      content.removeEventListener("focusin", handleFocusIn);
      window.visualViewport?.removeEventListener("resize", revealAfterReflow);
      cancelAnimationFrame(frame);
      clearTimeout(settleTimer);
    };
  }, [active, contentRef]);
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
  /**
   * `wide` is 840px at `lg` and up, for a form with a receipt photo beside it. Below `lg`
   * nothing changes: there the photo is a strip above the form, not a column.
   */
  size?: "default" | "wide";
}

export function Modal({ open, onClose, title, children, size = "default" }: ModalProps) {
  /**
   * `createPortal` needs a document, so the first render has to stay on the server's
   * output. A modal is never open on first paint, so nothing is missing before this
   * flips — and rendering the tree in place for one commit would reintroduce the very
   * clipping this portal exists to avoid.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const viewport = useVisualViewport(isMobile && open);

  useDialogLifecycle(open, dialogRef, contentRef, onClose);

  useKeepFocusedFieldVisible(open && isMobile, contentRef);

  // On mobile, pin the container to the visual viewport so Safari's
  // scroll-to-focused-input doesn't push the modal off-screen
  const containerStyle = viewport
    ? { top: `${viewport.offsetTop}px`, height: `${viewport.height}px`, bottom: "auto" as const }
    : undefined;

  const mobileMaxHeight = viewport
    ? `${viewport.height * 0.9}px`
    : "90vh";

  /**
   * Portalled to the body, and that is load-bearing rather than tidiness.
   *
   * `fixed inset-0` reads as immune to an ancestor, and is not: any ancestor with a
   * transform becomes the containing block for `position: fixed` descendants, so the
   * overlay resolves against *that* box instead of the viewport — and an
   * `overflow-hidden` on the way up then clips the dialog out of sight. The
   * transactions toolbar is both, and carries a transform even at rest, because
   * Tailwind's `translate-y-0` emits an identity matrix that still counts. Measured
   * there, the overlay came out 878×113 instead of 1200×827 and the dialog sat at
   * top −95, unclickable.
   *
   * It lives here rather than in each caller because the hazard is invisible until
   * someone clicks: `translate-*`, `scale-*`, `rotate-*` and `will-change` all
   * trigger it, and a class like `translate-y-0` looks like a no-op in a list.
   *
   * React event handlers still bubble to the JSX parent — portals bubble through the
   * React tree, not the DOM tree — so no caller's `onClick` changes behaviour. What
   * does change is ancestor CSS: a descendant selector rooted above the caller no
   * longer reaches inside.
   */
  const modal = (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
          style={containerStyle}
        >
          {/* Overlay */}
          <motion.div
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
                : "rounded-2xl max-w-lg max-h-[85vh]",
              !isMobile && size === "wide" && "lg:max-w-[840px]"
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

  if (!mounted) return null;
  return createPortal(modal, document.body);
}
