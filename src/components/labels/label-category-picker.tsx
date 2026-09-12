"use client";

import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/ui/icon-map";
import { useCategoriesQuery } from "@/hooks/use-categories";
import type { Category } from "@/types";

const EMPTY_CATEGORIES: Category[] = [];

interface LabelCategoryPickerProps {
  /** Selected category ids. **Empty means every category**, which is what "All" renders as. */
  value: string[];
  onChange: (categoryIds: string[]) => void;
  /** The label's own type restriction. Only categories of a matching type may be linked. */
  applicableTo: "EXPENSE" | "INCOME" | "BOTH";
}

const byTypeThenName = (a: Category, b: Category) =>
  a.type.localeCompare(b.type) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * The two-state category restriction on the label form: **All categories** or a specific set.
 *
 * Two states rather than a bare multi-select where "nothing selected" means "everything", which
 * is the same information but reads backwards at the exact moment it matters -- a user clearing
 * their last pick expects the label to stop appearing, not to appear everywhere.
 *
 * Unticking the last category therefore snaps the control back to "All categories" rather than
 * leaving a third, unsavable state on screen -- the two renderings of "no restriction" are the
 * same value, so they cannot drift apart.
 */
export function LabelCategoryPicker({ value, onChange, applicableTo }: LabelCategoryPickerProps) {
  const categoriesQuery = useCategoriesQuery();
  const categories = categoriesQuery.data ?? EMPTY_CATEGORIES;

  // A label restricted to expenses cannot be limited to an income category: the pair matches
  // nothing, and a label that silently stops appearing looks identical to one that was deleted.
  const selectable = useMemo(
    () =>
      categories
        .filter((category) => applicableTo === "BOTH" || category.type === applicableTo)
        .sort(byTypeThenName),
    [categories, applicableTo],
  );

  const isRestricted = value.length > 0;
  // The list is only usable once it has actually arrived. An unrestricted label is the common
  // case and used to short-circuit the pending and error branches entirely, which is how a failed
  // fetch reached the user as a dead button rather than as a failure.
  const categoriesLoaded = categoriesQuery.isSuccess;

  // Narrowing "Applies To" can invalidate picks that were legal when they were made: an
  // Expenses+Income label limited to Groceries and Salary, narrowed to Expenses, must not keep
  // Salary -- the pair matches nothing and the label would just stop appearing.
  //
  // Guarded on a settled query, because `selectable` is empty while categories are loading and
  // pruning against it would wipe a saved restriction on first mount. `onChange` is not in the
  // deps: the parent passes a fresh closure on every render, and depending on it re-runs this
  // effect forever.
  const onChangeRef = useRef(onChange);
  // Synced from an effect rather than during render, for the reason the sibling picker is:
  // a discarded render must not leave this holding a callback that never committed.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!categoriesQuery.isSuccess || value.length === 0) return;
    const allowed = new Set(selectable.map((category) => category.id));
    const kept = value.filter((id) => allowed.has(id));
    if (kept.length !== value.length) onChangeRef.current(kept);
  }, [categoriesQuery.isSuccess, selectable, value]);

  const toggle = (categoryId: string) => {
    onChange(
      value.includes(categoryId)
        ? value.filter((id) => id !== categoryId)
        : [...value, categoryId],
    );
  };

  return (
    <div>
      <p className="text-sm font-medium text-warm-600 mb-2">Categories</p>

      <div className="flex gap-2" role="group" aria-label="Category restriction">
        <button
          type="button"
          aria-pressed={!isRestricted}
          onClick={() => onChange([])}
          className={cn(
            "flex-1 min-h-11 rounded-xl px-3 text-sm font-medium transition-all duration-150",
            !isRestricted
              ? "bg-amber-light/60 text-amber-dark ring-2 ring-amber/30"
              : "bg-cream-100 text-warm-400 hover:bg-cream-200",
          )}
        >
          All categories
        </button>
        <button
          type="button"
          aria-pressed={isRestricted}
          // Disabled rather than inert while the list is unusable. It used to test
          // `selectable.length > 0` inside the handler, so a failed request left a button that
          // looked live and did nothing at all when pressed -- the silent no-op the house rule on
          // failed saves exists to prevent, and the error below was unreachable to explain it.
          disabled={!categoriesLoaded}
          onClick={() => {
            if (!isRestricted && selectable.length > 0) onChange([selectable[0].id]);
          }}
          className={cn(
            "flex-1 min-h-11 rounded-xl px-3 text-sm font-medium transition-all duration-150",
            "disabled:cursor-not-allowed disabled:opacity-50",
            isRestricted
              ? "bg-amber-light/60 text-amber-dark ring-2 ring-amber/30"
              : "bg-cream-100 text-warm-400 hover:bg-cream-200",
          )}
        >
          Specific categories
        </button>
      </div>

      {categoriesQuery.isPending ? (
        <div aria-label="Loading categories" className="mt-3 flex flex-wrap gap-2">
          {["w-24", "w-28", "w-20", "w-24"].map((width, index) => (
            <div key={index} className={cn("h-11 animate-shimmer rounded-full", width)} />
          ))}
        </div>
      ) : categoriesQuery.isError ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-expense/20 bg-expense-light/40 p-3">
          <span className="flex min-w-0 items-center gap-2 text-sm text-warm-600">
            <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-expense" />
            Couldn&apos;t load categories.
          </span>
          <button
            type="button"
            onClick={() => void categoriesQuery.refetch()}
            disabled={categoriesQuery.isFetching}
            className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-amber-dark transition-colors hover:bg-white/60 disabled:opacity-50"
          >
            {categoriesQuery.isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : selectable.length === 0 ? (
        <p className="mt-3 rounded-xl border border-cream-200 bg-cream-50/60 px-4 py-3 text-sm text-warm-400">
          No categories of a matching type yet. Create one first, or leave this on All categories.
        </p>
      ) : !isRestricted ? (
        <p className="text-[11px] text-warm-300 mt-1.5">
          This label is offered on every category of a matching type.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectable.map((category) => {
              const isSelected = value.includes(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggle(category.id)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium text-warm-600 transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:ring-offset-2",
                    isSelected
                      ? "border-amber/60 bg-amber-light/50 shadow-sm"
                      : "border-cream-300 bg-white hover:border-warm-300 hover:bg-cream-50",
                  )}
                >
                  <CategoryIcon
                    name={category.icon}
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0"
                    style={{ color: category.color }}
                  />
                  <span>{category.name}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors",
                      isSelected
                        ? "bg-amber text-white"
                        : "border border-cream-300 text-transparent",
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-warm-300 mt-2">
            Only transactions in these categories will offer this label.
          </p>
        </>
      )}
    </div>
  );
}
