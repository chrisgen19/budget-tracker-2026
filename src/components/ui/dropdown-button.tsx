"use client";

import { useState, useRef, useEffect, type ComponentType } from "react";
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

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
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

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-soft-lg border border-cream-300/60 overflow-hidden z-50"
          >
            {items.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onClick();
                }}
                disabled={item.disabled}
                className={cn(
                  "flex items-center gap-3 w-full px-4 py-3 text-left text-sm transition-colors",
                  item.disabled
                    ? "text-warm-300 cursor-not-allowed"
                    : "text-warm-600 hover:bg-cream-50"
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{item.label}</span>
                  {item.sublabel && (
                    <p
                      className={cn(
                        "text-xs mt-0.5",
                        item.disabled ? "text-warm-300" : "text-warm-400"
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
    </div>
  );
}
