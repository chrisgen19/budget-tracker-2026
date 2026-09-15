"use client";

import { useEffect, useMemo, useState } from "react";
import type { BudgetAllocationKind, Category } from "@prisma/client";
import { Modal } from "@/components/ui/modal";
import { CategoryIcon } from "@/components/ui/icon-map";
import { useSaveBudgetPlan } from "@/hooks/use-budget-plan";
import { useToast } from "@/components/ui/toast";
import type { BudgetPerformanceData } from "@/types";

interface DraftAllocation {
  amount: string;
  kind: BudgetAllocationKind;
  rolloverEnabled: boolean;
}

interface BudgetPlanEditorProps {
  open: boolean;
  onClose: () => void;
  month: string;
  timezoneOffset: number;
  categories: Category[];
  performance: BudgetPerformanceData;
  hideAmounts: boolean;
}

const initialDraft = (
  categories: Category[],
  performance: BudgetPerformanceData,
): Record<string, DraftAllocation> => {
  const saved = new Map(performance.allocations.map((row) => [row.categoryId, row]));
  return Object.fromEntries(categories.map((category) => {
    const row = saved.get(category.id);
    return [category.id, {
      amount: row ? String(row.planned) : "",
      kind: category.type === "INCOME" ? "INCOME" : (row?.kind ?? "FLEXIBLE"),
      rolloverEnabled: category.type === "EXPENSE" && (row?.rolloverEnabled ?? false),
    }];
  }));
};

function AllocationInput({
  category,
  value,
  onChange,
  hideAmounts,
}: {
  category: Category;
  value: DraftAllocation;
  onChange: (value: DraftAllocation) => void;
  hideAmounts: boolean;
}) {
  return (
    <div className="py-3 border-b border-cream-100 last:border-0">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${category.color}18`, color: category.color }}>
          <CategoryIcon name={category.icon} className="w-4 h-4" />
        </span>
        <label className="min-w-0 flex-1 text-sm font-medium text-warm-700" htmlFor={`budget-${category.id}`}>
          {category.name}
        </label>
        <input
          id={`budget-${category.id}`}
          inputMode="decimal"
          type={hideAmounts ? "password" : "number"}
          min="0"
          step="0.01"
          value={value.amount}
          onChange={(event) => onChange({ ...value, amount: event.target.value })}
          placeholder="0"
          className="w-28 min-h-11 rounded-lg border border-cream-300 bg-cream-50 px-3 text-right text-sm text-warm-700 outline-none focus:border-amber-400"
        />
      </div>
      {category.type === "EXPENSE" && value.amount && (
        <div className="mt-2 ml-12 flex flex-wrap items-center gap-3">
          <select
            aria-label={`${category.name} allocation type`}
            value={value.kind}
            onChange={(event) => onChange({ ...value, kind: event.target.value as BudgetAllocationKind })}
            className="min-h-11 rounded-lg border border-cream-300 bg-white px-3 text-sm text-warm-600"
          >
            <option value="FIXED">Fixed</option>
            <option value="FLEXIBLE">Flexible</option>
            <option value="SAVINGS">Savings</option>
          </select>
          <label className="min-h-11 flex items-center gap-2 text-sm text-warm-500">
            <input
              type="checkbox"
              checked={value.rolloverEnabled}
              onChange={(event) => onChange({ ...value, rolloverEnabled: event.target.checked })}
              className="w-4 h-4 accent-amber-600"
            />
            Roll over remaining
          </label>
        </div>
      )}
    </div>
  );
}

export function BudgetPlanEditor(props: BudgetPlanEditorProps) {
  const { open, onClose, month, timezoneOffset, categories, performance, hideAmounts } = props;
  const [draft, setDraft] = useState<Record<string, DraftAllocation>>({});
  const save = useSaveBudgetPlan(month, timezoneOffset);
  const { showToast } = useToast();

  useEffect(() => {
    if (open) setDraft(initialDraft(categories, performance));
  }, [categories, open, performance]);

  const sections = useMemo(() => ([
    { title: "Planned income", categories: categories.filter((category) => category.type === "INCOME") },
    { title: "Expense allocations", categories: categories.filter((category) => category.type === "EXPENSE") },
  ]), [categories]);

  const handleSave = async () => {
    const allocations = categories.flatMap((category) => {
      const row = draft[category.id];
      const amount = Number(row?.amount);
      if (!row || !Number.isFinite(amount) || amount <= 0) return [];
      return [{
        categoryId: category.id,
        amount,
        kind: category.type === "INCOME" ? "INCOME" as const : row.kind,
        rolloverEnabled: category.type === "EXPENSE" && row.rolloverEnabled,
      }];
    });
    try {
      const result = await save.mutateAsync({ allocations });
      showToast(`Budget revision ${result.revision} saved`);
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save budget plan", "error");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Budget plan · ${performance.periodLabel}`}>
      <div className="p-5 space-y-5">
        <p className="text-sm text-warm-400">
          Leave a category blank to keep it outside this month&apos;s plan. Each save creates an auditable revision.
        </p>
        {sections.map((section) => (
          <section key={section.title}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-400">{section.title}</h3>
            <div className="mt-1">
              {section.categories.map((category) => draft[category.id] && (
                <AllocationInput
                  key={category.id}
                  category={category}
                  value={draft[category.id]}
                  onChange={(value) => setDraft((current) => ({ ...current, [category.id]: value }))}
                  hideAmounts={hideAmounts}
                />
              ))}
            </div>
          </section>
        ))}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-cream-200 bg-white p-4">
          <button type="button" onClick={onClose} className="min-h-11 px-4 rounded-lg text-sm font-medium text-warm-500 hover:bg-cream-100">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={save.isPending} className="min-h-11 px-4 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
            {save.isPending ? "Saving…" : "Save revision"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
