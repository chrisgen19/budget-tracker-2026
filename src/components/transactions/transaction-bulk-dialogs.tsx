"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, FolderInput, MinusCircle, PlusCircle, Tags } from "lucide-react";
import { useCategoriesQuery } from "@/hooks/use-categories";
import { useLabelsQuery } from "@/hooks/use-labels";
import { CategoryIcon } from "@/components/ui/icon-map";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import type { LabelWithCountAndSchedules } from "@/types";

const EMPTY_LABELS: LabelWithCountAndSchedules[] = [];

function QueryErrorState({
  resource,
  retrying,
  onRetry,
}: {
  resource: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="rounded-xl border border-expense/20 bg-expense-light/40 p-4">
      <p className="text-sm text-warm-600">Could not load {resource}.</p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-2 min-h-11 rounded-lg px-3 text-sm font-semibold text-expense disabled:opacity-50"
      >
        {retrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  );
}

interface CategoryDialogProps {
  open: boolean;
  onClose: () => void;
  selectedCount: number;
  selectedTypes: Set<"INCOME" | "EXPENSE">;
  pending: boolean;
  onApply: (categoryId: string) => Promise<void>;
}

export function TransactionBulkCategoryDialog({
  open,
  onClose,
  selectedCount,
  selectedTypes,
  pending,
  onApply,
}: CategoryDialogProps) {
  const onlyType = selectedTypes.size === 1 ? Array.from(selectedTypes)[0] : undefined;
  const {
    data: categories = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useCategoriesQuery(onlyType);
  const [categoryId, setCategoryId] = useState("");
  const closeIfIdle = () => {
    if (!pending) onClose();
  };

  useEffect(() => {
    if (open) setCategoryId("");
  }, [open]);

  return (
    <Modal open={open} onClose={closeIfIdle} title="Change category">
      <p className="mb-4 text-sm text-warm-500">
        Apply one category to {selectedCount} selected transaction{selectedCount === 1 ? "" : "s"}.
      </p>
      {!onlyType ? (
        <div className="rounded-xl border border-amber/25 bg-amber-light/30 p-4 text-sm text-warm-600">
          Income and expense transactions use different categories. Select transactions of one
          type to change their category together.
        </div>
      ) : isLoading ? (
        <p className="py-6 text-center text-sm text-warm-400">Loading categories…</p>
      ) : isError ? (
        <QueryErrorState
          resource="categories"
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      ) : categories.length === 0 ? (
        <p className="rounded-xl bg-cream-50 p-4 text-sm text-warm-500">
          No {onlyType.toLowerCase()} categories are available.
        </p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {categories.map((category) => {
            const selected = category.id === categoryId;
            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategoryId(category.id)}
                disabled={pending}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors",
                  selected
                    ? "border-amber bg-amber-light/30"
                    : "border-cream-200 hover:bg-cream-50",
                )}
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${category.color}18`, color: category.color }}
                >
                  <CategoryIcon name={category.icon} className="h-4 w-4" />
                </span>
                <span className="flex-1 text-sm font-medium text-warm-700">{category.name}</span>
                {selected && <Check className="h-4 w-4 text-amber-dark" />}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={closeIfIdle}
          disabled={pending}
          className="min-h-11 flex-1 rounded-xl border border-cream-300 text-sm font-medium text-warm-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => categoryId && onApply(categoryId)}
          disabled={!categoryId || !onlyType || pending}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber text-sm font-medium text-white disabled:opacity-40"
        >
          <FolderInput className="h-4 w-4" />
          {pending ? "Applying…" : "Apply category"}
        </button>
      </div>
    </Modal>
  );
}

interface LabelsDialogProps {
  open: boolean;
  onClose: () => void;
  selectedCount: number;
  selectedTypes: Set<"INCOME" | "EXPENSE">;
  pending: boolean;
  onApply: (operation: "add" | "remove", labelIds: string[]) => Promise<void>;
}

export function TransactionBulkLabelsDialog({
  open,
  onClose,
  selectedCount,
  selectedTypes,
  pending,
  onApply,
}: LabelsDialogProps) {
  // Keep the loading fallback referentially stable. A literal `[]` here changes
  // `compatibleLabels` on every render, which retriggers the pruning effect below.
  const {
    data: labels = EMPTY_LABELS,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useLabelsQuery();
  const [operation, setOperation] = useState<"add" | "remove">("add");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const closeIfIdle = () => {
    if (!pending) onClose();
  };
  const compatibleLabels = useMemo(
    () =>
      labels.filter(
        (label) =>
          operation === "remove" ||
          label.applicableTo === "BOTH" ||
          (selectedTypes.size === 1 && selectedTypes.has(label.applicableTo as "INCOME" | "EXPENSE")),
      ),
    [labels, operation, selectedTypes],
  );

  useEffect(() => {
    if (open) {
      setOperation("add");
      setSelectedIds(new Set());
    }
  }, [open]);

  useEffect(() => {
    setSelectedIds((current) => {
      const allowed = new Set(compatibleLabels.map((label) => label.id));
      const next = new Set(Array.from(current).filter((id) => allowed.has(id)));
      if (next.size === current.size && Array.from(next).every((id) => current.has(id))) {
        return current;
      }
      return next;
    });
  }, [compatibleLabels]);

  const toggle = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Modal open={open} onClose={closeIfIdle} title="Manage labels">
      <p className="mb-4 text-sm text-warm-500">
        Add or remove labels on {selectedCount} selected transaction{selectedCount === 1 ? "" : "s"}.
      </p>
      <div className="mb-4 grid grid-cols-2 rounded-xl bg-cream-100 p-1">
        {(["add", "remove"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={operation === value}
            onClick={() => setOperation(value)}
            disabled={pending}
            className={cn(
              "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium capitalize",
              operation === value ? "bg-white text-warm-700 shadow-sm" : "text-warm-400",
            )}
          >
            {value === "add" ? <PlusCircle className="h-4 w-4" /> : <MinusCircle className="h-4 w-4" />}
            {value}
          </button>
        ))}
      </div>
      {isLoading ? (
        <p className="py-6 text-center text-sm text-warm-400">Loading labels…</p>
      ) : isError ? (
        <QueryErrorState
          resource="labels"
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      ) : labels.length === 0 ? (
        <p className="rounded-xl bg-cream-50 p-4 text-sm text-warm-500">
          No labels are available.
        </p>
      ) : compatibleLabels.length === 0 ? (
        <p className="rounded-xl bg-cream-50 p-4 text-sm text-warm-500">
          No labels are compatible with every selected transaction.
        </p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {compatibleLabels.map((label) => (
            <label
              key={label.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-cream-50"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(label.id)}
                onChange={() => toggle(label.id)}
                disabled={pending}
                className="h-5 w-5 accent-amber"
              />
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
              <span className="flex-1 text-sm font-medium text-warm-600">{label.name}</span>
              <span className="text-[11px] text-warm-300">{label.applicableTo.toLowerCase()}</span>
            </label>
          ))}
        </div>
      )}
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={closeIfIdle}
          disabled={pending}
          className="min-h-11 flex-1 rounded-xl border border-cream-300 text-sm font-medium text-warm-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onApply(operation, Array.from(selectedIds))}
          disabled={selectedIds.size === 0 || pending}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber text-sm font-medium text-white disabled:opacity-40"
        >
          <Tags className="h-4 w-4" />
          {pending ? "Applying…" : `${operation === "add" ? "Add" : "Remove"} labels`}
        </button>
      </div>
    </Modal>
  );
}
