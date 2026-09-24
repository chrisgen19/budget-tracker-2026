"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  description?: string;
}

interface ToastOptions {
  /** A muted second line under the message. Kept to one line and truncated, so the title stays short. */
  description?: string;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export const useToast = () => useContext(ToastContext);

const TOAST_DURATION = 3000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "success", options?: ToastOptions) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type, description: options?.description }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Toast container — fixed at top center.
          Above the modal layer, not level with it. This container renders here, inside
          the provider and before the page, while a Modal portals to the end of
          `document.body` — so at an equal z-index the later element wins and a modal's
          backdrop would blur the toast behind it. A save that fails while a form is
          open is exactly when the message matters most, so toasts own the top layer
          outright rather than by document order. */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              role={toast.type === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex w-[calc(100vw-2rem)] max-w-sm items-center gap-3 rounded-2xl border bg-white py-3 pl-3.5 pr-2 shadow-soft-lg",
                toast.type === "success" ? "border-income/20" : "border-expense/20"
              )}
            >
              {toast.type === "success" ? (
                <div className="w-8 h-8 rounded-full bg-income/10 flex items-center justify-center shrink-0">
                  <Check className="w-4 h-4 text-income" />
                </div>
              ) : (
                <div className="w-8 h-8 rounded-full bg-expense/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-expense" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-warm-800 leading-snug">{toast.message}</p>
                {toast.description && (
                  <p className="mt-0.5 truncate text-xs text-warm-500">{toast.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="relative shrink-0 p-1.5 rounded-lg text-warm-300 hover:text-warm-500 transition-colors before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
