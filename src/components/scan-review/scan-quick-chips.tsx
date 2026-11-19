"use client";

import type { ReactNode } from "react";
import { Check, Clock, Plus, Search } from "lucide-react";
import { CategoryIcon } from "@/components/ui/icon-map";
import { useCategoriesQuery, useQuickPreferencesQuery } from "@/hooks/use-categories";
import { useLabelsQuery, useQuickLabelsQuery } from "@/hooks/use-labels";
import { useScanItemLabels } from "@/hooks/use-scan-item-labels";
import { resolveQuickCategories } from "@/lib/quick-categories";
import { isLabelCompatible, resolveQuickLabels } from "@/lib/quick-labels";
import { cn } from "@/lib/utils";
import type { MultiScanItem } from "@/types";

export type ScanPickerKind = "category" | "labels";
export interface ScanItemPatch {
  categoryId?: string;
  labelIds?: string[];
}

interface ScanQuickChipsProps {
  item: MultiScanItem;
  /** Saving, or the row is pinned in an unconfirmed batch: edits would be discarded. */
  disabled: boolean;
  onUpdate: (id: string, patch: ScanItemPatch) => void;
  onMore: (kind: ScanPickerKind) => void;
}

// 36px chips with a 44px hit area: the house touch-target rule without taller cards.
const CHIP =
  "relative inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium transition-colors " +
  "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50 disabled:cursor-not-allowed disabled:opacity-50";
const CHIP_OFF = "border-cream-300 bg-white text-warm-500 hover:border-warm-300 hover:bg-cream-50";
const CHIP_ON = "border-amber/50 bg-amber-light text-warm-700";
const MORE = "border-dashed border-cream-400 bg-white text-warm-400 hover:text-warm-600";

function ChipRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold text-warm-400">{title}</p>
      {/* Bleeds to the card edge so a scrolled row is not clipped mid-chip by the padding. */}
      <div
        role="group"
        aria-label={title}
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
    </div>
  );
}

function Shimmer({ label }: { label: string }) {
  return (
    <div aria-label={label} className="flex gap-1.5 py-1">
      {["w-20", "w-24", "w-16"].map((width) => (
        <div key={width} className={cn("h-9 animate-shimmer rounded-full", width)} />
      ))}
    </div>
  );
}

function CategoryChips({ item, disabled, onUpdate, onMore }: ScanQuickChipsProps) {
  const type = item.data?.type ?? "EXPENSE";
  const categoriesQuery = useCategoriesQuery(type);
  const { data: quickPrefs } = useQuickPreferencesQuery();
  if (categoriesQuery.isPending) return <Shimmer label="Loading categories" />;
  if (categoriesQuery.isError || !categoriesQuery.data?.length) return null;

  const categories = categoriesQuery.data;
  const prefIds =
    type === "EXPENSE" ? quickPrefs?.quickExpenseCategories : quickPrefs?.quickIncomeCategories;
  const quick = resolveQuickCategories(prefIds ?? [], categories).display;
  const current = categories.find((c) => c.id === item.data?.categoryId);
  // The current pick leads only when the quick row lacks it, so tapping a quick chip never
  // reorders the row under the user's finger.
  const chips = current && !quick.some((c) => c.id === current.id) ? [current, ...quick] : quick;

  return (
    <ChipRow title="Category">
      {chips.map((cat) => {
        const on = cat.id === current?.id;
        return (
          <button
            key={cat.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => !on && onUpdate(item.id, { categoryId: cat.id })}
            className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
          >
            <CategoryIcon name={cat.icon} aria-hidden="true" className="h-3.5 w-3.5" style={{ color: cat.color }} />
            {cat.name}
          </button>
        );
      })}
      {categories.length > chips.length && (
        <button type="button" aria-label="More categories" disabled={disabled} onClick={() => onMore("category")} className={cn(CHIP, MORE)}>
          <Search aria-hidden="true" className="h-3.5 w-3.5" />
          More
        </button>
      )}
    </ChipRow>
  );
}

function LabelChips({ item, disabled, onUpdate, onMore }: ScanQuickChipsProps) {
  const labelsQuery = useLabelsQuery();
  const { data: pinnedIds = [] } = useQuickLabelsQuery();
  const { selectedIds, autoAppliedId, toggle } = useScanItemLabels(item);
  if (labelsQuery.isPending) return <Shimmer label="Loading labels" />;
  const labels = labelsQuery.data ?? [];
  const type = item.data?.type;
  const compatible = labels.filter((label) => isLabelCompatible(label, type));
  if (labelsQuery.isError || compatible.length === 0) return null;

  const quick = resolveQuickLabels(labels, pinnedIds, type, item.data?.categoryId);
  const quickIds = new Set(quick.map((label) => label.id));
  // Chosen elsewhere (More, the full form, a schedule): shown first so a selection is never hidden.
  const chosenElsewhere = labels.filter((l) => selectedIds.includes(l.id) && !quickIds.has(l.id));
  const chips = [...chosenElsewhere, ...quick];

  return (
    <ChipRow title="Labels">
      {chips.map((label) => {
        const on = selectedIds.includes(label.id);
        const auto = label.id === autoAppliedId;
        return (
          <button
            key={label.id}
            type="button"
            aria-pressed={on}
            aria-label={auto ? `${label.name}, automatically applied by schedule` : undefined}
            disabled={disabled}
            onClick={() => onUpdate(item.id, { labelIds: toggle(label.id) })}
            className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
          >
            {on ? (
              <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center rounded-full bg-amber text-white">
                <Check className="h-2.5 w-2.5" />
              </span>
            ) : (
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: label.color }} />
            )}
            {label.name}
            {auto && <Clock aria-hidden="true" className="h-3 w-3 text-amber-dark" />}
          </button>
        );
      })}
      {compatible.length > quick.length && (
        <button type="button" aria-label="More labels" disabled={disabled} onClick={() => onMore("labels")} className={cn(CHIP, MORE)}>
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          More
        </button>
      )}
    </ChipRow>
  );
}

/** One-tap category and label chips under a scanned receipt in the review. */
export function ScanQuickChips(props: ScanQuickChipsProps) {
  return (
    <div className="space-y-2">
      <CategoryChips {...props} />
      <LabelChips {...props} />
    </div>
  );
}
