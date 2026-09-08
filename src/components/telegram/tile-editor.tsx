"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import {
  deleteTile,
  patchTile,
  postTile,
  reorderTiles,
  type TgCategory,
  type TileInput,
  type TileView,
} from "@/components/telegram/tg-api";
import { useMainButton } from "@/components/telegram/use-telegram-webapp";

/**
 * Creating, renaming, reordering and deleting the grid's buttons, from inside Telegram.
 *
 * This screen is the reason the tiles became data at all. `quick-keyboard.ts` named the cost of
 * making them per-user as "a column, an editor and a settings page", and a Mini App is the editor,
 * so it stops being an additional cost and becomes the surface being built anyway.
 *
 * Reorder is arrows rather than drag. Drag inside a webview fights Telegram's own gestures, and
 * the list is at most twelve rows: two taps to move a button is not the friction worth solving.
 */

interface TileEditorProps {
  webApp: TelegramWebApp | null;
  initData: string;
  tiles: TileView[];
  categories: TgCategory[];
  maxTiles: number;
  onChanged: () => void;
  onDone: () => void;
}

export function TileEditor({
  webApp,
  initData,
  tiles,
  categories,
  maxTiles,
  onChanged,
  onDone,
}: TileEditorProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TileInput | null>(null);

  useMainButton(webApp, {
    text: "Done",
    visible: !draft,
    enabled: !busy,
    onClick: onDone,
  });

  /** Every mutation goes through here, so the failure and refresh handling cannot drift. */
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, delta: number) => {
    const next = [...tiles];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    // The whole ordered set, not a moved id and a position: the server refuses a partial list, so
    // a request that arrives late describes a grid the user actually saw rather than a patch
    // applied to one they did not.
    void run(() => reorderTiles(initData, next.map((t) => t.id)));
  };

  if (draft) {
    return (
      <TileForm
        categories={categories}
        draft={draft}
        busy={busy}
        error={error}
        onChange={setDraft}
        onCancel={() => setDraft(null)}
        onSave={async () => {
          await run(() => postTile(initData, draft));
          setDraft(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-3 p-4">
      <h1 className="font-display text-lg font-semibold text-warm-800">Your buttons</h1>

      {error ? (
        <p className="rounded-xl border border-expense-light bg-expense-light/40 p-3 text-sm text-expense-dark">
          {error}
        </p>
      ) : null}

      <ul className="space-y-2">
        {tiles.map((tile, index) => (
          <li
            key={tile.id}
            className="flex items-center gap-2 rounded-2xl border border-warm-200 bg-white p-3 shadow-soft"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-warm-800">{tile.label}</p>
              <p className="truncate text-xs text-warm-500">
                {tile.amount === null ? "Asks for an amount" : tile.amount} ·{" "}
                {tile.resolvedCategoryName ?? "no category"}
                {tile.fallsBack ? " (fallback)" : ""}
              </p>
            </div>

            {/* Arrows are min-h-11 for the 44px target even though the glyph is small. */}
            <button
              type="button"
              aria-label={`Move ${tile.label} up`}
              disabled={busy || index === 0}
              onClick={() => move(index, -1)}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-warm-500 active:bg-cream-200 disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Move ${tile.label} down`}
              disabled={busy || index === tiles.length - 1}
              onClick={() => move(index, 1)}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-warm-500 active:bg-cream-200 disabled:opacity-30"
            >
              <ArrowDown className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Delete ${tile.label}`}
              disabled={busy}
              onClick={() => void run(() => deleteTile(initData, tile.id))}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-expense active:bg-expense-light/40 disabled:opacity-30"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      {tiles.length < maxTiles ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            setDraft({ label: "", description: "", amount: null, type: "EXPENSE", categoryId: null })
          }
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-warm-300 py-3 text-sm text-warm-600 active:bg-cream-200"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add a button
        </button>
      ) : (
        <p className="text-center text-xs text-warm-500">
          {maxTiles} buttons is the most that fits. Delete one to add another.
        </p>
      )}

      {/* MainButton is absent outside Telegram, which is how this is reached in a browser. */}
      {!webApp ? (
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 w-full rounded-2xl bg-amber py-3 text-sm font-medium text-white"
        >
          Done
        </button>
      ) : null}
    </div>
  );
}

interface TileFormProps {
  categories: TgCategory[];
  draft: TileInput;
  busy: boolean;
  error: string | null;
  onChange: (draft: TileInput) => void;
  onCancel: () => void;
  onSave: () => void;
}

function TileForm({ categories, draft, busy, error, onChange, onCancel, onSave }: TileFormProps) {
  const usable = categories.filter((c) => c.type === draft.type);
  const ready = draft.label.trim().length > 0 && draft.description.trim().length > 0;

  return (
    <div className="space-y-3 p-4">
      <h1 className="font-display text-lg font-semibold text-warm-800">New button</h1>

      {error ? (
        <p className="rounded-xl border border-expense-light bg-expense-light/40 p-3 text-sm text-expense-dark">
          {error}
        </p>
      ) : null}

      <Field label="Button text" hint="Short: the grid is two columns.">
        <input
          value={draft.label}
          maxLength={40}
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
          className="w-full rounded-xl border border-warm-200 px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Description" hint="What lands in your transactions.">
        <input
          value={draft.description}
          maxLength={255}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          className="w-full rounded-xl border border-warm-200 px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Amount" hint="Leave empty to ask each time.">
        <input
          value={draft.amount ?? ""}
          inputMode="decimal"
          onChange={(e) => {
            const raw = e.target.value.trim();
            const parsed = Number(raw);
            // Empty is a real value here: it means the button opens the pad. `Number("")` is 0,
            // which would be a fixed zero-amount button instead.
            onChange({
              ...draft,
              amount: raw === "" || !Number.isFinite(parsed) || parsed <= 0 ? null : parsed,
            });
          }}
          className="w-full rounded-xl border border-warm-200 px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Category" hint="Leave on Decide automatically to match on the description.">
        <select
          value={draft.categoryId ?? ""}
          onChange={(e) => onChange({ ...draft, categoryId: e.target.value || null })}
          className="min-h-11 w-full rounded-xl border border-warm-200 px-3 py-2 text-sm"
        >
          <option value="">Decide automatically</option>
          {usable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 flex-1 rounded-2xl border border-warm-200 py-3 text-sm text-warm-600"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready || busy}
          onClick={onSave}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-amber py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Save
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-warm-600">{label}</span>
      {children}
      <span className="mt-1 block text-[11px] text-warm-500">{hint}</span>
    </label>
  );
}
