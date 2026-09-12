"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  MAX_TILE_LABELS,
  telegramQuickTileSchema,
  type TelegramQuickTileInput,
} from "@/lib/validations";
import { resolveTileCategory } from "@/lib/telegram/quick-tiles";
import { LabelPicker } from "@/components/transactions/label-picker";
import { useCategoriesQuery } from "@/hooks/use-categories";
import { cn } from "@/lib/utils";

interface QuickTileFormProps {
  /** The tile being edited, or a partial draft to prefill a new one from. */
  defaults?: Partial<TelegramQuickTileInput>;
  submitLabel: string;
  onSubmit: (input: TelegramQuickTileInput) => Promise<void>;
  onCancel: () => void;
  /** A refusal from the server, shown above the fields where it can be acted on. */
  error?: string | null;
}

/**
 * Creating and editing one button, from the web app.
 *
 * The Mini App's editor (`tile-editor.tsx`) is deliberately not shared with this. It runs inside a
 * webview with no room for a label picker and validates with a single `ready` boolean, because
 * three taps is its whole premise. This is the full editor, and the one place labels are pinned.
 *
 * The category field echoes where a tap will *actually* file whenever that is not what was
 * chosen, computed with the same `resolveTileCategory` the write runs. Anything else would let the
 * editor's promise and the button's behaviour drift, which is the exact drift that function was
 * extracted to prevent.
 */
export function QuickTileForm({
  defaults,
  submitLabel,
  onSubmit,
  onCancel,
  error,
}: QuickTileFormProps) {
  const { data: categories = [] } = useCategoriesQuery();

  // Held as the string typed rather than the parsed number: "0." and "38.0" are states a number
  // cannot hold, and rendering the parsed value back eats the decimal point mid-entry.
  const seededAmount =
    defaults?.amount === undefined || defaults?.amount === null ? "" : String(defaults.amount);
  const [rawAmount, setRawAmount] = useState(seededAmount);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TelegramQuickTileInput>({
    resolver: zodResolver(telegramQuickTileSchema),
    defaultValues: {
      label: defaults?.label ?? "",
      description: defaults?.description ?? "",
      amount: defaults?.amount ?? null,
      type: defaults?.type ?? "EXPENSE",
      categoryId: defaults?.categoryId ?? null,
      labelIds: defaults?.labelIds ?? [],
    },
  });

  const type = watch("type");
  const categoryId = watch("categoryId");
  const description = watch("description");
  const labelIds = watch("labelIds") ?? [];
  // Pins already on the stored tile. `checkPinnedLabels` re-judges them only when the pins, the
  // type or the category actually move, so an unrelated edit must not have them dropped underneath
  // it -- and `viewTiles` already reports a stale pin rather than hiding it.
  const attachedLabelIds = useMemo(() => defaults?.labelIds ?? [], [defaults]);

  const selectable = useMemo(
    () => categories.filter((c) => c.type === type),
    [categories, type]
  );

  // What a tap would file under right now. Recomputed as the description is typed, since with no
  // category chosen that is what decides it.
  const resolved = useMemo(
    () =>
      resolveTileCategory(
        { description: description || "", type, categoryId: categoryId ?? null },
        categories.map((c) => ({ id: c.id, name: c.name, type: c.type }))
      ),
    [description, type, categoryId, categories]
  );

  const submit = handleSubmit(async (values) => {
    await onSubmit({
      ...values,
      // The two-decimal bound applies to what the user **typed**, never to a figure they did not
      // touch. A stored amount can carry more precision than this field accepts -- the Mini App's
      // editor has no such bound -- and running it through the parser turned it into `null`, which
      // is the "ask each time" state. Renaming a button would silently have changed what it does.
      //
      // Otherwise: empty, unparseable or non-positive all mean the same thing, ask on the way in.
      // Parsed here rather than in the input's `onChange` so the raw string survives every
      // intermediate state.
      amount: rawAmount === seededAmount ? (defaults?.amount ?? null) : parseAmount(rawAmount),
    });
  });

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? (
        <p className="rounded-xl bg-expense/10 px-3 py-2 text-sm text-expense">{error}</p>
      ) : null}

      <div>
        <label htmlFor="tile-label" className="mb-1 block text-sm font-medium text-warm-600">
          Button name
        </label>
        <input
          id="tile-label"
          {...register("label")}
          maxLength={40}
          placeholder="To office"
          className="w-full rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-warm-700 outline-none transition focus:border-amber"
        />
        <p className="mt-1 text-xs text-warm-400">
          What the button reads. Kept short - the grid is narrow on a phone.
        </p>
        {errors.label && <p className="mt-1 text-sm text-expense">{errors.label.message}</p>}
      </div>

      <div>
        <label htmlFor="tile-description" className="mb-1 block text-sm font-medium text-warm-600">
          Note
        </label>
        <input
          id="tile-description"
          {...register("description")}
          maxLength={255}
          placeholder="UV Express - office to house"
          className="w-full rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-warm-700 outline-none transition focus:border-amber"
        />
        <p className="mt-1 text-xs text-warm-400">
          What lands in the transaction. Separate from the name, because &quot;Office&quot; is a
          good button and a useless ledger entry a year later.
        </p>
        {errors.description && (
          <p className="mt-1 text-sm text-expense">{errors.description.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="tile-amount" className="mb-1 block text-sm font-medium text-warm-600">
          Amount
        </label>
        <input
          id="tile-amount"
          inputMode="decimal"
          value={rawAmount}
          onChange={(e) => setRawAmount(e.target.value)}
          placeholder="Leave empty to ask each time"
          className="w-full rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-warm-700 outline-none transition focus:border-amber"
        />
        <p className="mt-1 text-xs text-warm-400">
          {parseAmount(rawAmount) === null
            ? "This button will ask for an amount when you tap it."
            : "One tap logs this amount."}
        </p>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-warm-600">Type</span>
        <div className="grid grid-cols-2 gap-2">
          {(["EXPENSE", "INCOME"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                // Guarded on the type actually changing. Clicking the already-selected option is a
                // no-op the user reads as one, and clearing on it silently dropped an existing
                // tile's category and every pinned label -- a save then recategorised the button
                // and unpinned it, for a click that changed nothing.
                if (option === type) return;
                setValue("type", option);
                // A category and a label chosen for the other type would be refused by the server,
                // so they are cleared here rather than left to fail on save. The refusal exists
                // for a hostile client; a form should not be able to reach it.
                setValue("categoryId", null);
                setValue("labelIds", []);
              }}
              className={cn(
                "min-h-11 rounded-xl border px-3 text-sm font-medium transition",
                type === option
                  ? "border-amber bg-amber/10 text-amber-dark"
                  : "border-cream-300 bg-white text-warm-500 hover:border-warm-300"
              )}
            >
              {option === "EXPENSE" ? "Expense" : "Income"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="tile-category" className="mb-1 block text-sm font-medium text-warm-600">
          Category
        </label>
        <select
          id="tile-category"
          value={categoryId ?? ""}
          onChange={(e) => setValue("categoryId", e.target.value === "" ? null : e.target.value)}
          className="min-h-11 w-full rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-warm-700 outline-none transition focus:border-amber"
        >
          <option value="">Decide automatically from the note</option>
          {selectable.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {/* Shown whenever a tap would not file where the field says, which is every case the user
            cannot otherwise see: no category chosen, or one that no longer matches the type. */}
        {resolved && resolved.via !== "tile" ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-warm-500">
            <AlertTriangle className="h-3 w-3 shrink-0 text-amber" aria-hidden />
            This will file under <strong className="font-medium">{resolved.categoryName}</strong>.
          </p>
        ) : null}
        {!resolved ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-expense">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
            There is no category to file this under. Seed your categories first.
          </p>
        ) : null}
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-warm-600">Labels</span>
        <LabelPicker
          selectedIds={labelIds}
          onChange={(ids) => setValue("labelIds", ids)}
          // The *resolved* category, not the box: with none chosen the description decides where
          // a tap files, and the server now judges pins against that same resolution. Passing the
          // raw value would offer labels the save then refuses.
          categoryId={resolved?.categoryId ?? null}
          attachedIds={attachedLabelIds}
          transactionType={type}
        />
        {/* Rendered, or pressing Save past the cap does nothing at all: the resolver refuses the
            form before `onSubmit` runs, and `LabelPicker` has no cap of its own to stop at. */}
        {errors.labelIds && (
          <p className="mt-1 text-sm text-expense">
            A button can pin at most {MAX_TILE_LABELS} labels. Remove{" "}
            {labelIds.length - MAX_TILE_LABELS} to save.
          </p>
        )}
        <p className="mt-2 text-xs text-warm-400">
          {labelIds.length > 0
            ? "These are applied instead of your scheduled labels when this button is tapped."
            : "With none pinned, your label schedules apply as usual."}
        </p>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 flex-1 rounded-xl border border-cream-300 bg-white px-4 text-sm font-medium text-warm-600 transition hover:bg-cream-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber px-4 text-sm font-medium text-white transition hover:bg-amber-dark disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Digits with optional thousands separators and at most two decimal places, and nothing else.
 *
 * Anchored at both ends, which is the whole point: this is an unrestricted text input
 * (`inputMode="decimal"` is a keyboard hint, not a constraint), so it receives pasted and typed
 * text that is not a number.
 *
 * The two-decimal bound is enforced rather than merely described. `amount` is a `Float` and every
 * currency formatter here renders two places, so `38.999` was stored and logged exactly while the
 * card, the toast and the ledger all showed 39.00 -- the button disagreeing with the row it wrote.
 * Excess precision is refused rather than rounded: rounding decides for the user, and on the tile
 * form a refusal is visible (the hint switches to "will ask for an amount") where a silent 39.00
 * is not.
 */
const AMOUNT_PATTERN = /^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$/;

/**
 * The typed string as an amount, or null for "ask each time".
 *
 * Empty, unparseable and non-positive all collapse to null on purpose. A zero-amount transaction
 * is a real thing to write by accident and nothing downstream would flag it, so the only two
 * outcomes here are a positive figure or the asking state.
 *
 * The **whole** string has to be a number, which `Number.parseFloat` alone does not give: it
 * accepts a numeric prefix and discards the rest, so a pasted `1,000` came back as 1 and `12abc`
 * as 12. The typed text stayed on screen while the wrong figure was written, which on the amount
 * prompt is one tap from a logged transaction off by a factor of a thousand.
 *
 * Thousands separators are stripped rather than refused, because rejecting `1,000` here would
 * return null -- and on the tile form null is a *meaningful* state, "ask each time", so the paste
 * would silently change what the button does instead of silently changing its amount. Neither
 * silent outcome is acceptable; accepting the figure the user plainly meant is.
 */
export const parseAmount = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) return null;

  const parsed = Number.parseFloat(trimmed.replace(/,/g, ""));
  return !Number.isFinite(parsed) || parsed <= 0 ? null : parsed;
};
