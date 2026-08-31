"use client";

import { useId, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronRight, Clock, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLabelsQuery, useQuickLabelsQuery } from "@/hooks/use-labels";
import type { LabelWithCountAndSchedules } from "@/types";

/** Minimum number of stable quick choices shown before the full picker. */
const QUICK_LABEL_COUNT = 4;
/** Search is useful once the full checkbox list is no longer easy to scan at a glance. */
const SEARCH_LABEL_THRESHOLD = 8;
const EMPTY_LABELS: LabelWithCountAndSchedules[] = [];
const EMPTY_QUICK_LABEL_IDS: string[] = [];

interface LabelPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  autoAppliedIds?: string[];
  transactionType?: "INCOME" | "EXPENSE";
}

const isCompatible = (
  label: LabelWithCountAndSchedules,
  transactionType?: "INCOME" | "EXPENSE",
) =>
  !transactionType ||
  label.applicableTo === "BOTH" ||
  label.applicableTo === transactionType;

const byName = (a: LabelWithCountAndSchedules, b: LabelWithCountAndSchedules) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

const byUsageThenName = (
  a: LabelWithCountAndSchedules,
  b: LabelWithCountAndSchedules,
) => b._count.transactions - a._count.transactions || byName(a, b);

export function LabelPicker({
  selectedIds,
  onChange,
  autoAppliedIds = [],
  transactionType,
}: LabelPickerProps) {
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const pickerId = useId();
  const hintId = `${pickerId}-hint`;
  const allLabelsId = `${pickerId}-all`;
  const labelsQuery = useLabelsQuery();
  const quickLabelsQuery = useQuickLabelsQuery();
  const labels = labelsQuery.data ?? EMPTY_LABELS;
  const quickLabelIds = quickLabelsQuery.data ?? EMPTY_QUICK_LABEL_IDS;

  const compatibleLabels = useMemo(
    () => labels.filter((label) => isCompatible(label, transactionType)),
    [labels, transactionType],
  );

  const selectedLabels = useMemo(
    () =>
      selectedIds
        .map((id) => labels.find((label) => label.id === id))
        .filter((label): label is LabelWithCountAndSchedules => label != null),
    [labels, selectedIds],
  );

  // Quick choices never depend on selection, so choosing a label cannot make the
  // buttons jump around. Respect the user's pin order, then backfill with labels
  // they use most often (alphabetical for equal counts).
  const quickLabels = useMemo(() => {
    const compatibleById = new Map(compatibleLabels.map((label) => [label.id, label]));
    const pinned = quickLabelIds
      .map((id) => compatibleById.get(id))
      .filter((label): label is LabelWithCountAndSchedules => label != null);
    const pinnedIds = new Set(pinned.map((label) => label.id));
    const backfill = compatibleLabels
      .filter((label) => !pinnedIds.has(label.id))
      .sort(byUsageThenName);

    return [...pinned, ...backfill].slice(
      0,
      Math.max(QUICK_LABEL_COUNT, pinned.length),
    );
  }, [compatibleLabels, quickLabelIds]);

  const quickIds = useMemo(() => new Set(quickLabels.map((label) => label.id)), [quickLabels]);
  const selectedOutsideQuick = selectedLabels.filter((label) => !quickIds.has(label.id));
  const fullLabels = useMemo(() => {
    const compatibleIds = new Set(compatibleLabels.map((label) => label.id));
    const selectedIncompatible = selectedLabels.filter((label) => !compatibleIds.has(label.id));
    return [...selectedIncompatible, ...compatibleLabels].sort(byName);
  }, [compatibleLabels, selectedLabels]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleFullLabels = normalizedSearch
    ? fullLabels.filter((label) => label.name.toLocaleLowerCase().includes(normalizedSearch))
    : fullLabels;
  const selectedCount = selectedLabels.length;
  const hasMore = fullLabels.some((label) => !quickIds.has(label.id));
  const labelsPending =
    !labelsQuery.isError && (labelsQuery.isPending || quickLabelsQuery.isPending);

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    );
  };

  const closeAll = () => {
    setShowAll(false);
    setSearch("");
  };

  const renderQuickChip = (label: LabelWithCountAndSchedules) => {
    const isSelected = selectedIds.includes(label.id);
    const isAuto = autoAppliedIds.includes(label.id);

    return (
      <button
        key={label.id}
        type="button"
        aria-pressed={isSelected}
        aria-label={
          isAuto
            ? `${label.name}, automatically applied by schedule`
            : label.name
        }
        onClick={() => toggle(label.id)}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium text-warm-600 transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:ring-offset-2",
          isSelected
            ? "border-amber/60 bg-amber-light/50 shadow-sm"
            : "border-cream-300 bg-white hover:border-warm-300 hover:bg-cream-50",
        )}
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: label.color }}
        />
        <span>{label.name}</span>
        {isAuto && (
          <Clock
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-amber-dark"
          />
        )}
        <span
          aria-hidden="true"
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors",
            isSelected ? "bg-amber text-white" : "border border-cream-300 text-transparent",
          )}
        >
          <Check className="h-3 w-3" />
        </span>
      </button>
    );
  };

  const renderSelectedChip = (label: LabelWithCountAndSchedules) => (
    <button
      key={label.id}
      type="button"
      onClick={() => toggle(label.id)}
      aria-label={`Remove ${label.name} label`}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-amber/40 bg-amber-light/40 px-3.5 py-2 text-sm font-medium text-warm-600 transition-colors hover:bg-amber-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      {label.name}
      <X aria-hidden="true" className="h-3.5 w-3.5 text-warm-400" />
    </button>
  );

  return (
    <fieldset aria-describedby={hintId} className="min-w-0">
      <legend className="w-full p-0">
        <span className="flex w-full items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-warm-600">
            Labels <span className="font-normal text-warm-300">(Optional)</span>
          </span>
          {!labelsPending && !labelsQuery.isError && selectedCount > 0 && (
            <span className="shrink-0 text-xs font-medium text-warm-400">
              {selectedCount} selected
            </span>
          )}
        </span>
      </legend>
      <p id={hintId} className="mb-3 mt-1 text-xs text-warm-400">
        Select all that apply.
      </p>

      {labelsPending ? (
        <div aria-label="Loading labels" className="flex flex-wrap gap-2">
          {["w-28", "w-32", "w-20"].map((width, index) => (
            <div key={index} className={cn("h-11 animate-shimmer rounded-full", width)} />
          ))}
        </div>
      ) : labelsQuery.isError ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-expense/20 bg-expense-light/40 p-3">
          <span className="flex min-w-0 items-center gap-2 text-sm text-warm-600">
            <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-expense" />
            Couldn&apos;t load labels.
          </span>
          <button
            type="button"
            onClick={() => void labelsQuery.refetch()}
            disabled={labelsQuery.isFetching}
            className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-amber-dark transition-colors hover:bg-white/60 disabled:opacity-50"
          >
            {labelsQuery.isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : labels.length === 0 ? (
        <div className="rounded-xl border border-cream-200 bg-cream-50/60 px-4 py-3 text-sm text-warm-400">
          No labels yet. You can create and pin labels from the Labels page.
        </div>
      ) : fullLabels.length === 0 ? (
        <div className="rounded-xl border border-cream-200 bg-cream-50/60 px-4 py-3 text-sm text-warm-400">
          No labels are available for {transactionType === "INCOME" ? "income" : "expenses"}.
        </div>
      ) : showAll ? (
        <div id={allLabelsId} className="space-y-4">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <button
              type="button"
              onClick={closeAll}
              className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-warm-500 transition-colors hover:bg-cream-100 hover:text-warm-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back to form
            </button>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="min-h-11 rounded-lg px-2 text-sm font-medium text-warm-400 transition-colors hover:bg-cream-100 hover:text-expense focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50"
              >
                Clear
              </button>
            )}
          </div>

          {selectedLabels.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-400">
                Selected
              </p>
              <div className="flex flex-wrap gap-2">{selectedLabels.map(renderSelectedChip)}</div>
            </div>
          )}

          {fullLabels.length >= SEARCH_LABEL_THRESHOLD && (
            <label className="relative block">
              <span className="sr-only">Search labels</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-300"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search labels"
                className="min-h-11 w-full rounded-xl border border-cream-300 bg-cream-50/50 py-2.5 pl-10 pr-4 text-sm text-warm-700 placeholder:text-warm-300 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30"
              />
            </label>
          )}

          {visibleFullLabels.length === 0 ? (
            <div className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-warm-400">
              No labels match “{search.trim()}”.
            </div>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {visibleFullLabels.map((label) => {
                const checked = selectedIds.includes(label.id);
                const isAuto = autoAppliedIds.includes(label.id);
                return (
                  <label
                    key={label.id}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors",
                      checked
                        ? "border-amber/30 bg-amber-light/30"
                        : "border-transparent hover:bg-cream-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(label.id)}
                      className="h-5 w-5 shrink-0 accent-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:ring-offset-2"
                    />
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-warm-600">
                      {label.name}
                    </span>
                    {isAuto && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-amber-dark">
                        <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                        Auto-applied
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          <div role="group" aria-label="Quick label choices" className="flex flex-wrap gap-2">
            {quickLabels.map(renderQuickChip)}
          </div>

          {selectedOutsideQuick.length > 0 && (
            <div className="rounded-xl bg-cream-50/70 p-3">
              <p className="mb-2 text-xs font-medium text-warm-400">Also selected</p>
              <div className="flex flex-wrap gap-2">
                {selectedOutsideQuick.map(renderSelectedChip)}
              </div>
            </div>
          )}

          {hasMore && (
            <button
              type="button"
              aria-expanded="false"
              aria-controls={allLabelsId}
              onClick={() => setShowAll(true)}
              className="flex min-h-11 w-full items-center justify-between rounded-xl border border-cream-200 px-4 py-2.5 text-sm font-medium text-warm-500 transition-colors hover:border-cream-300 hover:bg-cream-50 hover:text-warm-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/40"
            >
              Browse all {fullLabels.length} labels
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}
