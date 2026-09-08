"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
  /** `id` present means this is an edit of an existing tile; absent means a new one. */
  const [draft, setDraft] = useState<(TileInput & { id?: string }) | null>(null);

  useMainButton(webApp, {
    text: "Done",
    visible: !draft,
    enabled: !busy,
    onClick: onDone,
  });

  /**
   * Every mutation goes through here, so the failure and refresh handling cannot drift.
   *
   * Returns whether it worked. Callers need that: closing a form unconditionally after `await`
   * throws the user's typed values away on a failure that is often theirs to correct -- a
   * duplicate label, most obviously -- leaving an error message about a form that is no longer
   * on screen.
   */
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
      return false;
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
    const { id, ...values } = draft;
    return (
      <TileForm
        // Keyed so opening a different tile remounts the form rather than carrying the previous
        // entry's raw amount string across.
        key={id ?? "new"}
        categories={categories}
        draft={values}
        editing={id !== undefined}
        busy={busy}
        error={error}
        onChange={(next) => setDraft({ ...next, ...(id ? { id } : {}) })}
        onCancel={() => {
          setError(null);
          setDraft(null);
        }}
        onSave={async () => {
          const ok = await run(() =>
            id ? patchTile(initData, id, values) : postTile(initData, values)
          );
          // Closed only on success. A duplicate label is the common failure here and it is the
          // user's to correct, so the form and everything typed into it stays put.
          if (ok) setDraft(null);
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
              aria-label={`Edit ${tile.label}`}
              disabled={busy}
              onClick={() =>
                setDraft({
                  id: tile.id,
                  label: tile.label,
                  description: tile.description,
                  amount: tile.amount,
                  type: tile.type,
                  categoryId: tile.categoryId,
                })
              }
              className="flex h-11 w-11 items-center justify-center rounded-xl text-warm-500 active:bg-cream-200 disabled:opacity-30"
            >
              <Pencil className="h-4 w-4" aria-hidden />
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
  editing: boolean;
  busy: boolean;
  error: string | null;
  onChange: (draft: TileInput) => void;
  onCancel: () => void;
  onSave: () => void;
}

function TileForm({ categories, draft, editing, busy, error, onChange, onCancel, onSave }: TileFormProps) {
  const usable = categories.filter((c) => c.type === draft.type);
  const ready = draft.label.trim().length > 0 && draft.description.trim().length > 0;
  // Seeded once from the draft, then owned by the field. Keyed by the form's identity upstream, so
  // opening a different tile remounts rather than carrying the previous entry over.
  const [rawAmount, setRawAmount] = useState(draft.amount === null ? "" : String(draft.amount));

  return (
    <div className="space-y-3 p-4">
      <h1 className="font-display text-lg font-semibold text-warm-800">
        {editing ? "Edit button" : "New button"}
      </h1>

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
          // The *typed* string, not a re-derivation of the parsed number. Rendering
          // `draft.amount` here ate the decimal point as it was typed: "38." parses to 38, which
          // renders as "38", and the separator could never be entered at all. Same reason the
          // numeric pad holds its entry as a string.
          value={rawAmount}
          inputMode="decimal"
          onChange={(e) => {
            const raw = e.target.value;
            setRawAmount(raw);
            const parsed = Number(raw.trim());
            // Empty is a real value here: it means the button opens the pad. `Number("")` is 0,
            // which would be a fixed zero-amount button instead.
            onChange({
              ...draft,
              amount: raw.trim() === "" || !Number.isFinite(parsed) || parsed <= 0 ? null : parsed,
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
