"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { X, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  confirmIcon?: LucideIcon;
  loading?: boolean;
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Delete",
  confirmIcon: ConfirmIcon = Trash2,
  loading = false,
}: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-warm-500 text-sm mb-6">{message}</div>
      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-expense hover:bg-expense-dark text-white font-medium text-sm transition-colors disabled:opacity-50"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <ConfirmIcon className="w-4 h-4" />
              {confirmLabel}
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}
