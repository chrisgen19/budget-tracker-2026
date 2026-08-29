"use client";

import { useEffect, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import type { TransactionFilterOptions } from "@/hooks/use-transaction-filter-options";
import { cn } from "@/lib/utils";
import type { TransactionFilters } from "@/components/transactions/transaction-filters";

const SORT_OPTIONS = [
  { label: "Newest first", sortBy: "date" as const, sortDir: "desc" as const },
  { label: "Oldest first", sortBy: "date" as const, sortDir: "asc" as const },
  { label: "Highest amount", sortBy: "amount" as const, sortDir: "desc" as const },
  { label: "Lowest amount", sortBy: "amount" as const, sortDir: "asc" as const },
];

const SOURCE_OPTIONS = [
  { value: "ALL" as const, label: "Any source" },
  { value: "APP" as const, label: "In app" },
  { value: "MCP" as const, label: "Claude" },
  { value: "TELEGRAM" as const, label: "Telegram" },
];

export type AdvancedFilterValues = Pick<
  TransactionFilters,
  | "categoryId"
  | "labelId"
  | "createdVia"
  | "amountMin"
  | "amountMax"
  | "sortBy"
  | "sortDir"
>;

interface TransactionFilterDialogProps {
  open: boolean;
  onClose: () => void;
  filters: TransactionFilters;
  options: TransactionFilterOptions;
  currencySymbol: string;
  onApply: (values: AdvancedFilterValues) => void;
}

const parseOptionalAmount = (value: string) => {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function TransactionFilterDialog({
  open,
  onClose,
  filters,
  options,
  currencySymbol,
  onApply,
}: TransactionFilterDialogProps) {
  const [draft, setDraft] = useState(filters);
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(filters);
    setAmountMin(filters.amountMin === null ? "" : String(filters.amountMin));
    setAmountMax(filters.amountMax === null ? "" : String(filters.amountMax));
  }, [filters, open]);

  useEffect(() => {
    if (!open) return;
    setDraft((current) => {
      const categoryId = !options.categoriesPending && !options.categoriesError && current.categoryId && !options.categories.some((category) => category.id === current.categoryId) ? null : current.categoryId;
      const labelId = !options.labelsPending && !options.labelsError && current.labelId && !options.labels.some((label) => label.id === current.labelId) ? null : current.labelId;
      return categoryId === current.categoryId && labelId === current.labelId
        ? current
        : { ...current, categoryId, labelId };
    });
  }, [open, options]);

  const parsedMin = parseOptionalAmount(amountMin);
  const parsedMax = parseOptionalAmount(amountMax);
  const negativeAmount =
    (parsedMin !== null && parsedMin < 0) || (parsedMax !== null && parsedMax < 0);
  const invertedRange =
    parsedMin !== null && parsedMax !== null && parsedMin > parsedMax;
  const amountInvalid = negativeAmount || invertedRange;
  const optionsLoading =
    (options.categoriesPending && draft.categoryId !== null) ||
    (options.labelsPending && draft.labelId !== null);

  const reset = () => {
    setDraft((current) => ({
      ...current,
      categoryId: null,
      labelId: null,
      createdVia: "ALL",
      amountMin: null,
      amountMax: null,
      sortBy: "date",
      sortDir: "desc",
    }));
    setAmountMin("");
    setAmountMax("");
  };

  const apply = () => {
    if (amountInvalid || optionsLoading) return;
    onApply({
      categoryId: draft.categoryId,
      labelId: draft.labelId,
      createdVia: draft.createdVia,
      amountMin: parsedMin,
      amountMax: parsedMax,
      sortBy: draft.sortBy,
      sortDir: draft.sortDir,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Filter & sort">
      <div className="space-y-5">
        <p className="text-sm leading-6 text-warm-400">
          Narrow the list by category, label, amount, or where it was added.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <FilterSelect label="Category" value={draft.categoryId} onChange={(categoryId) => setDraft((current) => ({ ...current, categoryId }))} items={options.categories} pending={options.categoriesPending} error={options.categoriesError} emptyLabel="No categories available" unavailableLabel="Selected category unavailable" onRetry={() => void options.retryCategories()} />
          <FilterSelect label="Label" value={draft.labelId} onChange={(labelId) => setDraft((current) => ({ ...current, labelId }))} items={options.labels} pending={options.labelsPending} error={options.labelsError} emptyLabel="No labels yet" unavailableLabel="Selected label unavailable" onRetry={() => void options.retryLabels()} />
        </div>

        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-warm-400">Amount range</legend>
          <div className="flex items-center gap-2">
            <AmountInput label="Minimum amount" value={amountMin} onChange={setAmountMin} placeholder="Minimum" currencySymbol={currencySymbol} invalid={amountInvalid} describedBy={amountInvalid ? "amount-range-error" : undefined} />
            <span aria-hidden="true" className="text-warm-300">–</span>
            <AmountInput label="Maximum amount" value={amountMax} onChange={setAmountMax} placeholder="Maximum" currencySymbol={currencySymbol} invalid={amountInvalid} describedBy={amountInvalid ? "amount-range-error" : undefined} />
          </div>
          {amountInvalid && (
            <p id="amount-range-error" className="mt-1.5 text-xs font-medium text-expense">
              {negativeAmount
                ? "Amounts must be zero or greater."
                : "Maximum amount must be greater than or equal to minimum amount."}
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-400">Added via</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SOURCE_OPTIONS.map((option) => (
              <button key={option.value} type="button" onClick={() => setDraft((current) => ({ ...current, createdVia: option.value }))} aria-pressed={draft.createdVia === option.value} className={cn("min-h-11 rounded-xl border px-3 text-sm font-medium transition-colors", draft.createdVia === option.value ? "border-amber/40 bg-amber-light/30 text-amber-dark" : "border-cream-200 text-warm-500 hover:bg-cream-50")}>
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <SortOptions draft={draft} onChange={setDraft} />

        <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center gap-2 border-t border-cream-200 bg-white px-6 py-4">
          <button type="button" onClick={reset} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-warm-400 transition-colors hover:bg-cream-100 hover:text-warm-700">Reset</button>
          <button type="button" onClick={apply} disabled={amountInvalid || optionsLoading} className="min-h-11 flex-1 rounded-xl bg-amber px-5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-amber-dark disabled:cursor-not-allowed disabled:opacity-50">{optionsLoading ? "Loading filters…" : "Apply filters"}</button>
        </div>
      </div>
    </Modal>
  );
}

interface FilterSelectProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  items: { id: string; name: string }[];
  pending: boolean;
  error: boolean;
  emptyLabel: string;
  unavailableLabel: string;
  onRetry: () => void;
}

function FilterSelect({ label, value, onChange, items, pending, error, emptyLabel, unavailableLabel, onRetry }: FilterSelectProps) {
  const pluralLabel = label === "Category" ? "categories" : `${label.toLowerCase()}s`;
  const selectedMissing = value !== null && !items.some((item) => item.id === value);
  const disabled = pending || (items.length === 0 && value === null);
  const firstLabel = pending
    ? `Loading ${pluralLabel}…`
    : error
      ? `${pluralLabel[0].toUpperCase()}${pluralLabel.slice(1)} unavailable`
      : items.length === 0
        ? emptyLabel
        : `All ${pluralLabel}`;

  return (
    <div className="space-y-1.5">
      <label>
        <span className="text-xs font-semibold uppercase tracking-wide text-warm-400">{label}</span>
        <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} disabled={disabled} className="mt-1.5 min-h-11 w-full rounded-xl border border-cream-200 bg-cream-50/60 px-3 text-sm text-warm-700 outline-none transition focus:border-amber focus:bg-white focus:ring-2 focus:ring-amber/20 disabled:cursor-not-allowed disabled:text-warm-300">
          <option value="">{firstLabel}</option>
          {selectedMissing && <option value={value!}>{pending ? `Loading selected ${label.toLowerCase()}…` : unavailableLabel}</option>}
          {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {error && (
        <button type="button" onClick={onRetry} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-expense transition-colors hover:bg-expense/5">
          Couldn’t load {pluralLabel}. Retry
        </button>
      )}
    </div>
  );
}

function SortOptions({ draft, onChange }: { draft: TransactionFilters; onChange: React.Dispatch<React.SetStateAction<TransactionFilters>> }) {
  return (
    <fieldset>
      <legend className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warm-400"><ArrowUpDown className="h-3.5 w-3.5" /> Sort by</legend>
      <div className="grid grid-cols-2 gap-2">
        {SORT_OPTIONS.map((option) => {
          const selected = draft.sortBy === option.sortBy && draft.sortDir === option.sortDir;
          return (
            <button key={option.label} type="button" onClick={() => onChange((current) => ({ ...current, sortBy: option.sortBy, sortDir: option.sortDir }))} aria-pressed={selected} className={cn("min-h-11 rounded-xl border px-3 text-left text-sm font-medium transition-colors", selected ? "border-amber/40 bg-amber-light/30 text-amber-dark" : "border-cream-200 text-warm-500 hover:bg-cream-50")}>
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function AmountInput({ label, value, onChange, placeholder, currencySymbol, invalid, describedBy }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; currencySymbol: string; invalid: boolean; describedBy?: string }) {
  return (
    <label className="relative min-w-0 flex-1">
      <span className="sr-only">{label}</span>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-warm-300">{currencySymbol}</span>
      <input type="number" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} min="0" inputMode="decimal" aria-invalid={invalid} aria-describedby={describedBy} className="min-h-11 min-w-0 w-full rounded-xl border border-cream-200 bg-cream-50/60 py-2.5 pl-8 pr-3 text-sm text-warm-700 outline-none transition placeholder:text-warm-300 focus:border-amber focus:bg-white focus:ring-2 focus:ring-amber/20" />
    </label>
  );
}
