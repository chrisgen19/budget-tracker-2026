"use client";

import { useState, useRef, useEffect, type ComponentType, type RefObject } from "react";
import { ChevronDown, type LucideProps } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export interface DropdownItem {
  label: string;
  sublabel?: string;
  icon: ComponentType<LucideProps>;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Close the menu on a click outside it or on Escape. Shared with ActionFab,
 * which opens the same menu upward from a floating button -- a second copy
 * would drift the moment either dismissal rule changed.
 */
export function useDismissOnOutside(
  open: boolean,
  close: () => void,
  containerRef: RefObject<HTMLElement | null>,
) {
  // Held in a ref so an inline `() => setOpen(false)` does not re-subscribe
  // both listeners on every render the menu is open.
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeRef.current();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, containerRef]);
}

interface DropdownMenuProps {
  open: boolean;
  items: DropdownItem[];
  onSelect: () => void;
  /** Which side of the trigger the panel opens on. */
  placement?: "bottom" | "top";
}

/**
 * The menu panel itself. `placement="top"` is what a bottom-anchored trigger
 * needs: a floating button has no room below it, so the panel opens upward and
 * animates from that edge instead.
 */
export function DropdownMenu({ open, items, onSelect, placement = "bottom" }: DropdownMenuProps) {
  const offscreenY = placement === "bottom" ? -4 : 4;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="menu"
          initial={{ opacity: 0, scale: 0.95, y: offscreenY }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: offscreenY }}
          transition={{ duration: 0.15 }}
          className={cn(
            "absolute right-0 w-56 bg-white rounded-xl shadow-soft-lg border border-cream-300/60 overflow-hidden z-50",
            placement === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                if (item.disabled) return;
                onSelect();
                item.onClick();
              }}
              disabled={item.disabled}
              className={cn(
                "flex items-center gap-3 w-full px-4 py-3 text-left text-sm transition-colors",
                item.disabled
                  ? "text-warm-300 cursor-not-allowed"
                  : "text-warm-600 hover:bg-cream-50",
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-medium">{item.label}</span>
                {item.sublabel && (
                  <p
                    className={cn(
                      "text-xs mt-0.5",
                      item.disabled ? "text-warm-300" : "text-warm-400",
                    )}
                  >
                    {item.sublabel}
                  </p>
                )}
              </div>
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface DropdownButtonProps {
  label: string;
  icon: ComponentType<LucideProps>;
  items: DropdownItem[];
  className?: string;
}

export function DropdownButton({
  label,
  icon: Icon,
  items,
  className,
}: DropdownButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside(open, () => setOpen(false), containerRef);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium text-sm px-4 py-2 rounded-xl transition-colors shadow-soft hover:shadow-soft-md",
          className
        )}
      >
        <Icon className="w-4 h-4" />
        {label}
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      <DropdownMenu open={open} items={items} onSelect={() => setOpen(false)} />
    </div>
  );
}
