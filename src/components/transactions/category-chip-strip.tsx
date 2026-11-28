import { CategoryIcon } from "@/components/ui/icon-map";
import { cn } from "@/lib/utils";

interface ChipCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
}

interface CategoryChipStripProps {
  /** Already resolved quick categories, in display order. */
  categories: ChipCategory[];
  /** "" when none is selected. */
  selectedId: string;
  /** Render the trailing "More…" chip. */
  showMore: boolean;
  onPick: (id: string) => void;
  onMore: () => void;
}

const CHIP_CLASS =
  "min-h-11 shrink-0 rounded-full border border-cream-200 px-3 text-sm text-warm-600 inline-flex items-center gap-1.5";

/** Keeps the focused amount input focused until the click handler runs. */
const keepFocus = (e: React.SyntheticEvent) => e.preventDefault();

export function CategoryChipStrip({ categories, selectedId, showMore, onPick, onMore }: CategoryChipStripProps) {
  return (
    <div
      role="toolbar"
      aria-label="Pick a category"
      className="flex gap-2 overflow-x-auto px-3 py-2 bg-cream-50 border-t border-cream-200"
    >
      {categories.map((cat) => {
        const selected = cat.id === selectedId;
        return (
          <button
            key={cat.id}
            type="button"
            aria-pressed={selected}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => onPick(cat.id)}
            className={cn(CHIP_CLASS, selected ? "bg-amber-light ring-2 ring-amber/40" : "bg-white")}
          >
            <CategoryIcon name={cat.icon} className="w-4 h-4" style={{ color: cat.color }} />
            {cat.name}
          </button>
        );
      })}
      {showMore && (
        <button
          type="button"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
          onClick={onMore}
          className={cn(CHIP_CLASS, "bg-white")}
        >
          More…
        </button>
      )}
    </div>
  );
}
