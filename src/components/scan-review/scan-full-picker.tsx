"use client";

import { useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import { CategoryIcon } from "@/components/ui/icon-map";
import { useCategoriesQuery } from "@/hooks/use-categories";
import { useLabelsQuery } from "@/hooks/use-labels";
import { useScanItemLabels } from "@/hooks/use-scan-item-labels";
import { byLabelName, isLabelCompatible } from "@/lib/quick-labels";
import { cn } from "@/lib/utils";
import type { MultiScanItem } from "@/types";
import type { ScanItemPatch, ScanPickerKind } from "./scan-quick-chips";

interface ScanFullPickerProps {
  item: MultiScanItem;
  kind: ScanPickerKind;
  onUpdate: (id: string, patch: ScanItemPatch) => void;
  onClose: () => void;
}

const matches = (name: string, search: string) =>
  name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());

const EMPTY = "rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-warm-400";

function CategoryList({ item, search, onUpdate, onClose }: ScanFullPickerProps & { search: string }) {
  const { data, isPending, isError } = useCategoriesQuery(item.data?.type ?? "EXPENSE");
  if (isPending) return <div className="h-40 animate-shimmer rounded-xl" />;
  if (isError) return <p className={EMPTY}>Couldn&apos;t load categories.</p>;
  const visible = (data ?? []).filter((c) => matches(c.name, search));
  if (visible.length === 0) return <p className={EMPTY}>No categories match “{search.trim()}”.</p>;

  return (
    <div className="grid grid-cols-3 gap-2">
      {visible.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => {
            onUpdate(item.id, { categoryId: cat.id });
            onClose();
          }}
          className={cn(
            "flex min-h-11 flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-all",
            cat.id === item.data?.categoryId ? "border-amber bg-amber-light/50" : "border-cream-200 hover:border-cream-400",
          )}
        >
          <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: cat.color + "18" }}>
            <CategoryIcon name={cat.icon} className="h-5 w-5" style={{ color: cat.color }} />
          </span>
          <span className="w-full truncate text-center text-xs leading-tight text-warm-600">{cat.name}</span>
        </button>
      ))}
    </div>
  );
}

function LabelList({ item, search, onUpdate, onClose }: ScanFullPickerProps & { search: string }) {
  const { data, isPending, isError } = useLabelsQuery();
  const { selectedIds, autoAppliedId, toggle } = useScanItemLabels(item);
  if (isPending) return <div className="h-40 animate-shimmer rounded-xl" />;
  if (isError) return <p className={EMPTY}>Couldn&apos;t load labels.</p>;
  // Already-selected labels stay listed even if the type excludes them, so they can be removed.
  const offered = (data ?? [])
    .filter((l) => isLabelCompatible(l, item.data?.type) || selectedIds.includes(l.id))
    .sort(byLabelName);
  const visible = offered.filter((l) => matches(l.name, search));

  return (
    <>
      {visible.length === 0 ? (
        <p className={EMPTY}>No labels match “{search.trim()}”.</p>
      ) : (
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {visible.map((label) => {
            const checked = selectedIds.includes(label.id);
            return (
              <label key={label.id} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2", checked ? "border-amber/30 bg-amber-light/30" : "border-transparent hover:bg-cream-50")}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onUpdate(item.id, { labelIds: toggle(label.id) })}
                  className="h-5 w-5 shrink-0 accent-amber"
                />
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                <span className="flex-1 text-sm text-warm-700">{label.name}</span>
                {label.id === autoAppliedId && (
                  <>
                    <span aria-hidden="true" className="text-[11px] text-amber-dark">Scheduled</span>
                    <span className="sr-only">, automatically applied by schedule</span>
                  </>
                )}
              </label>
            );
          })}
        </div>
      )}
      <button type="button" onClick={onClose} className="mt-4 min-h-11 w-full rounded-xl bg-amber py-3 text-sm font-medium text-white shadow-soft transition-colors hover:bg-amber-dark">
        Done
      </button>
    </>
  );
}

/** Full, searchable category or label picker for one scanned receipt, shown in place of the list. */
export function ScanFullPicker(props: ScanFullPickerProps) {
  const [search, setSearch] = useState("");
  const isCategory = props.kind === "category";

  // No heading of its own: the sheet's title already names this picker (`useScanReviewPicker`),
  // and a second one left the dialog's `aria-labelledby` pointing at a stale title.
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={props.onClose}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg px-2 text-sm font-medium text-warm-500 transition-colors hover:bg-cream-100 hover:text-warm-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/50"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to receipts
      </button>
      <label className="relative block">
        <span className="sr-only">{isCategory ? "Search categories" : "Search labels"}</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-300" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={isCategory ? "Search categories" : "Search labels"}
          className="min-h-11 w-full rounded-xl border border-cream-300 bg-cream-50/50 py-2.5 pl-10 pr-4 text-sm text-warm-700 placeholder:text-warm-300 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/30"
        />
      </label>
      {isCategory ? <CategoryList {...props} search={search} /> : <LabelList {...props} search={search} />}
    </div>
  );
}
