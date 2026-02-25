"use client";

import { useEffect, useState } from "react";
import { Pencil, Trash2, AlertCircle, CheckCircle2, Loader2, Rows3 } from "lucide-react";
import { CategoryIcon } from "@/components/ui/icon-map";
import { formatCurrency } from "@/lib/utils";
import { useUser } from "@/components/user-provider";
import type { Category, MultiScanItem } from "@/types";

interface MultiScanReviewProps {
  items: MultiScanItem[];
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onItemize: (id: string) => void;
  onSaveAll: () => void;
  onClose: () => void;
  isSaving: boolean;
}

export function MultiScanReview({
  items,
  onEdit,
  onRemove,
  onItemize,
  onSaveAll,
  onClose,
  isSaving,
}: MultiScanReviewProps) {
  const { user } = useUser();
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    const fetchCategories = async () => {
      const res = await fetch("/api/categories");
      const data = await res.json();
      setCategories(data);
    };
    fetchCategories();
  }, []);

  const resolveCategory = (categoryId?: string) =>
    categories.find((c) => c.id === categoryId);

  const scanningCount = items.filter((i) => i.status === "scanning").length;
  const breakingDownCount = items.filter((i) => i.status === "breaking_down").length;
  const successCount = items.filter((i) => i.status === "success").length;
  const isStillScanning = scanningCount > 0;
  const isBreakingDown = breakingDownCount > 0;
  const totalItems = items.length;
  const scannedSoFar = totalItems - scanningCount;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <p className="text-sm text-warm-400">No receipts to review.</p>
        <button
          type="button"
          onClick={onClose}
          className="px-6 py-2.5 rounded-xl border border-cream-300 text-warm-500 font-medium text-sm hover:bg-cream-100 transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Progress indicator */}
      {isStillScanning && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-light/50 border border-amber/20">
          <div className="w-5 h-5 border-2 border-amber/30 border-t-amber rounded-full animate-spin shrink-0" />
          <p className="text-sm font-medium text-amber-dark">
            Scanning {scannedSoFar + 1} of {totalItems}...
          </p>
        </div>
      )}

      {/* Item list */}
      <div className="space-y-3">
        {items.map((item) => {
          if (item.status === "scanning") {
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 p-4 rounded-xl border border-cream-200 bg-cream-50/50"
              >
                <div className="w-10 h-10 rounded-xl bg-cream-100 flex items-center justify-center shrink-0">
                  <Loader2 className="w-5 h-5 text-warm-300 animate-spin" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-warm-500 truncate">{item.fileName}</p>
                  <p className="text-xs text-warm-300">Scanning...</p>
                </div>
              </div>
            );
          }

          if (item.status === "breaking_down") {
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 p-4 rounded-xl border border-amber/20 bg-amber-light/30"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center shrink-0">
                  <Loader2 className="w-5 h-5 text-amber animate-spin" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-dark truncate">{item.fileName}</p>
                  <p className="text-xs text-amber-dark/70">Itemizing receipt...</p>
                </div>
              </div>
            );
          }

          if (item.status === "error") {
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 p-4 rounded-xl border border-expense/20 bg-expense-light/30"
              >
                <div className="w-10 h-10 rounded-xl bg-expense-light flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5 text-expense" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-warm-600 truncate">{item.fileName}</p>
                  <p className="text-xs text-expense">{item.error ?? "Failed to scan"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="p-2 rounded-lg text-warm-300 hover:text-expense hover:bg-expense-light transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          }

          // Success state
          const category = resolveCategory(item.data?.categoryId);
          const formattedDate = item.data?.date
            ? new Date(item.data.date).toLocaleDateString("en-PH", {
                month: "short",
                day: "numeric",
              })
            : "";
          const canItemize = !!item.imageFile && !item.parentId && !!item.data?.multiCategory;
          const isItemizedChild = !!item.parentId;

          return (
            <div
              key={item.id}
              className="flex items-center gap-3 p-4 rounded-xl border border-cream-200 bg-white"
            >
              {/* Category icon */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: category ? category.color + "18" : "#f5f0eb",
                }}
              >
                {category ? (
                  <CategoryIcon
                    name={category.icon}
                    className="w-5 h-5"
                    style={{ color: category.color }}
                  />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-income" />
                )}
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-warm-700 truncate">
                    {item.data?.description || "No description"}
                  </p>
                  {isItemizedChild && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-light/60 text-amber-dark shrink-0">
                      Itemized
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {category && (
                    <span className="text-xs text-warm-400">{category.name}</span>
                  )}
                  {category && formattedDate && (
                    <span className="text-xs text-warm-200">&middot;</span>
                  )}
                  {formattedDate && (
                    <span className="text-xs text-warm-400">{formattedDate}</span>
                  )}
                </div>
              </div>

              {/* Amount */}
              <p className="text-sm font-semibold text-warm-700 tabular-nums shrink-0">
                {item.data?.amount
                  ? formatCurrency(item.data.amount, user.currency)
                  : "—"}
              </p>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {canItemize && (
                  <button
                    type="button"
                    onClick={() => onItemize(item.id)}
                    title="Itemize receipt"
                    className="p-2 rounded-lg text-warm-300 hover:text-amber hover:bg-amber-light transition-colors"
                  >
                    <Rows3 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onEdit(item.id)}
                  className="p-2 rounded-lg text-warm-300 hover:text-amber-dark hover:bg-amber-light transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  className="p-2 rounded-lg text-warm-300 hover:text-expense hover:bg-expense-light transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer — sticky save button */}
      {!isStillScanning && successCount > 0 && (
        <div className="sticky bottom-0 -mx-6 -mb-6 px-6 py-4 bg-white border-t border-cream-200/60">
          <button
            type="button"
            onClick={onSaveAll}
            disabled={isSaving || isBreakingDown}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              `Add ${successCount} Transaction${successCount !== 1 ? "s" : ""}`
            )}
          </button>
        </div>
      )}
    </div>
  );
}
