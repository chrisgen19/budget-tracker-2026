import { useEffect, useRef, type RefObject } from "react";

/**
 * Body scroll lock, ref-counted across every open dialog.
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
/** Open dialogs, innermost last: only the top one answers Escape and traps Tab. */
const dialogStack: symbol[] = [];
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

/** Keep Tab inside `dialog`, wrapping at either end. */
const trapTab = (event: KeyboardEvent, dialog: HTMLElement) => {
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true",
  );
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

/**
 * What every dialog does while open, shared by `Modal` and the full-screen receipt viewer:
 * lock body scroll, close on Escape and trap Tab (only for the innermost dialog, so a viewer
 * over a Modal closes alone), move focus to `focusRef` on open and back to the opener on close.
 */
export function useDialogLifecycle(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  focusRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const tokenRef = useRef(Symbol("dialog"));
  // Kept in a ref so the effect does not re-run on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    lockBodyScroll();
    const token = tokenRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogStack.push(token);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) trapTab(event, dialogRef.current);
    };

    document.addEventListener("keydown", handleKeyDown);

    // Move focus in unless a child has autoFocus. Delayed so the entry animation renders first.
    const focusTimer = setTimeout(() => {
      const target = focusRef.current;
      if (target && !target.contains(document.activeElement)) target.focus({ preventScroll: true });
    }, 50);

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      const stackIndex = dialogStack.lastIndexOf(token);
      if (stackIndex !== -1) dialogStack.splice(stackIndex, 1);
      unlockBodyScroll();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, dialogRef, focusRef]);
}
