"use client";

import { AlertTriangle, Pencil, Plus } from "lucide-react";
import type { FrequentTile, TileView } from "@/components/telegram/tg-api";

/**
 * The grid itself: configured buttons first, then whatever the ledger says is frequent.
 *
 * Configured tiles come first and keep a stable position, because the whole value is muscle
 * memory -- the right button is found without reading. A derived tile whose position moves is
 * fine, since it is labelled as derived; a configured one that moves is a mis-tap.
 */

const money = (currency: string, amount: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);

interface TileButtonProps {
  label: string;
  /** Null renders as "asks", so a tap that opens the pad looks different before it is pressed. */
  amount: number | null;
  currency: string;
  note?: string;
  warn?: boolean;
  /** Pinned labels, rendered as their colours. Names would not survive a three-column grid. */
  labels?: TileView["labels"];
  disabled?: boolean;
  onPress: () => void;
}

function TileButton({
  label,
  amount,
  currency,
  note,
  warn,
  labels,
  disabled,
  onPress,
}: TileButtonProps) {
  // Only the pins that will actually be written. One whose label was narrowed to the other
  // transaction type is silently absent here rather than shown and then not applied, which is the
  // same rule the write itself follows -- and the web page, where they are edited, says why.
  const applied = (labels ?? []).filter((l) => l.applies);
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      // min-h-24 keeps every tile well past the 44px touch target the design rules require, and
      // gives a three-column grid something finger-sized on a phone.
      className="relative flex min-h-24 flex-col items-start justify-between rounded-2xl border border-warm-200 bg-white p-3 text-left shadow-soft transition active:scale-[0.97] disabled:opacity-50"
    >
      <span className="line-clamp-2 text-sm font-medium leading-tight text-warm-800">{label}</span>
      {applied.length > 0 ? (
        <span className="flex flex-wrap gap-1" aria-label={`Labels: ${applied.map((l) => l.name).join(", ")}`}>
          {applied.map((l) => (
            <span
              key={l.id}
              title={l.name}
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: l.color }}
            />
          ))}
        </span>
      ) : null}
      <span className="flex w-full items-baseline justify-between gap-1">
        <span className="font-display text-lg font-semibold text-amber">
          {amount === null ? "Ask" : money(currency, amount)}
        </span>
        {note ? (
          <span
            className={`flex items-center gap-0.5 text-[10px] ${warn ? "text-expense" : "text-warm-500"}`}
          >
            {warn ? <AlertTriangle className="h-3 w-3" aria-hidden /> : null}
            {note}
          </span>
        ) : null}
      </span>
    </button>
  );
}

interface TileGridProps {
  tiles: TileView[];
  frequent: FrequentTile[];
  currency: string;
  busy: boolean;
  onTile: (tile: TileView) => void;
  onFrequent: (entry: FrequentTile) => void;
  onEdit: () => void;
}

export function TileGrid({
  tiles,
  frequent,
  currency,
  busy,
  onTile,
  onFrequent,
  onEdit,
}: TileGridProps) {
  const fixed = tiles.filter((t) => t.amount !== null);
  const asks = tiles.filter((t) => t.amount === null);

  return (
    <div className="space-y-5 p-4">
      {tiles.length === 0 && frequent.length === 0 ? (
        <EmptyGrid onEdit={onEdit} />
      ) : null}

      {fixed.length > 0 ? (
        <Section title="Routine">
          {fixed.map((tile) => (
            <TileButton
              key={tile.id}
              label={tile.label}
              amount={tile.amount}
              currency={currency}
              // Shown on every tile that will not file where it says, so a category deleted while
              // the app was closed is visible in the grid rather than discovered on the next tap.
              note={tile.fallsBack ? (tile.resolvedCategoryName ?? "no category") : undefined}
              warn={tile.fallsBack}
              labels={tile.labels}
              disabled={busy}
              onPress={() => onTile(tile)}
            />
          ))}
        </Section>
      ) : null}

      {asks.length > 0 ? (
        <Section title="Custom amount">
          {asks.map((tile) => (
            <TileButton
              key={tile.id}
              label={tile.label}
              amount={null}
              currency={currency}
              note={tile.fallsBack ? (tile.resolvedCategoryName ?? "no category") : undefined}
              warn={tile.fallsBack}
              labels={tile.labels}
              disabled={busy}
              onPress={() => onTile(tile)}
            />
          ))}
        </Section>
      ) : null}

      {frequent.length > 0 ? (
        <Section title="Frequent" subtitle="from what you log">
          {frequent.map((entry) => (
            <TileButton
              key={entry.key}
              label={entry.description}
              // An unstable amount shows "Ask" and opens the pad prefilled. The user may assert a
              // fixed amount; this section may only suggest one.
              amount={entry.amountIsStable ? entry.amount : null}
              currency={currency}
              note={`${entry.count}x`}
              disabled={busy}
              onPress={() => onFrequent(entry)}
            />
          ))}
        </Section>
      ) : null}

      <button
        type="button"
        onClick={onEdit}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-warm-300 py-3 text-sm text-warm-600 active:bg-cream-200"
      >
        <Pencil className="h-4 w-4" aria-hidden />
        Edit buttons
      </button>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-warm-500">
        {title}
        {subtitle ? <span className="font-normal normal-case tracking-normal">{subtitle}</span> : null}
      </h2>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  );
}

function EmptyGrid({ onEdit }: { onEdit: () => void }) {
  return (
    <div className="rounded-2xl border border-warm-200 bg-white p-6 text-center shadow-soft">
      <p className="font-display text-base font-semibold text-warm-800">No buttons yet</p>
      <p className="mt-1 text-sm text-warm-600">
        Add one for something you log often, and it becomes a single tap.
      </p>
      <button
        type="button"
        onClick={onEdit}
        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber px-4 py-2 text-sm font-medium text-white active:bg-amber-dark"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add your first button
      </button>
    </div>
  );
}
