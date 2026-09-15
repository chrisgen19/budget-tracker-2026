"use client";

import { useFieldArray, useForm, type FieldErrors, type UseFormRegister, type UseFormSetValue } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import {
  cardPurchasesFormSchema,
  MAX_BATCH_TRANSACTIONS,
  type CardPurchaseLine,
} from "@/lib/validations";
import { cn, formatCurrency } from "@/lib/utils";
import { accountDateKey } from "@/lib/account-time";
import { useUser } from "@/components/user-provider";
import { useCategoriesQuery } from "@/hooks/use-categories";
import { useLabelsQuery } from "@/hooks/use-labels";
import {
  Field,
  FormActions,
  INPUT_CLASS,
  optionalNumber,
} from "@/components/credit-accounts/form-parts";
import type { Category } from "@/types";

interface PurchaseRows {
  lines: CardPurchaseLine[];
}

interface LabelOption {
  id: string;
  name: string;
  color: string;
}

/** What the lines add up to, summed in cents. Blank amounts add nothing. */
export const purchasesTotal = (lines: readonly { amount?: number | null }[]): number =>
  lines.reduce((cents, line) => {
    const amount = typeof line.amount === "number" && Number.isFinite(line.amount) ? line.amount : 0;
    return cents + Math.round(amount * 100);
  }, 0) / 100;

const blankLine = (date: string): CardPurchaseLine => ({
  date,
  description: "",
  categoryId: "",
  // Undefined rather than 0 or NaN, so the field renders empty.
  amount: undefined as unknown as number,
  labelIds: [],
});

interface LineProps {
  index: number;
  register: UseFormRegister<PurchaseRows>;
  setValue: UseFormSetValue<PurchaseRows>;
  errors: FieldErrors<PurchaseRows>["lines"];
  categories: Category[];
  loadingCategories: boolean;
  labels: LabelOption[];
  selectedLabelIds: string[];
  onRemove?: () => void;
}

function PurchaseLineFields({
  index,
  register,
  setValue,
  errors,
  categories,
  loadingCategories,
  labels,
  selectedLabelIds,
  onRemove,
}: LineProps) {
  const lineErrors = errors?.[index];
  const toggleLabel = (id: string) =>
    setValue(
      `lines.${index}.labelIds`,
      selectedLabelIds.includes(id) ? selectedLabelIds.filter((l) => l !== id) : [...selectedLabelIds, id]
    );

  return (
    <fieldset className="space-y-3 rounded-xl border border-cream-300/60 p-3">
      <legend className="sr-only">Purchase {index + 1}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date" error={lineErrors?.date?.message}>
          <input type="date" {...register(`lines.${index}.date`)} className={INPUT_CLASS} />
        </Field>
        <Field label="Amount" error={lineErrors?.amount ? "Enter an amount above 0" : undefined}>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            {...register(`lines.${index}.amount`, { setValueAs: optionalNumber })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <Field label="Description" error={lineErrors?.description?.message}>
        <input type="text" {...register(`lines.${index}.description`)} className={INPUT_CLASS} placeholder="e.g. Google One" />
      </Field>
      <Field label="Category" error={lineErrors?.categoryId?.message}>
        <select {...register(`lines.${index}.categoryId`)} className={INPUT_CLASS}>
          <option value="">{loadingCategories ? "Loading categories…" : "Choose…"}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>
      {labels.length > 0 && (
        <div role="group" aria-label={`Labels for purchase ${index + 1}`} className="flex flex-wrap gap-1.5">
          {labels.map((label) => {
            const on = selectedLabelIds.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleLabel(label.id)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                  on ? "border-transparent" : "border-cream-300 text-warm-500"
                )}
                style={on ? { backgroundColor: `${label.color}22`, color: label.color } : undefined}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color }} />
                {label.name}
              </button>
            );
          })}
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-warm-400 transition-colors hover:text-expense"
        >
          <Trash2 className="h-4 w-4" />
          Remove line
        </button>
      )}
    </fieldset>
  );
}

interface CardPurchasesFormProps {
  onSubmit: (lines: CardPurchaseLine[]) => Promise<void>;
  onCancel: () => void;
}

/**
 * Several purchases on one card at once, such as a statement being caught up on. Each line becomes an
 * ordinary expense, so it shows in every category and label report on the day it was bought. The
 * running total is there to check against the statement before saving.
 */
export function CardPurchasesForm({ onSubmit, onCancel }: CardPurchasesFormProps) {
  const { user } = useUser();
  const {
    data: categories = [],
    isLoading: loadingCategories,
    isError: categoriesFailed,
    refetch: refetchCategories,
  } = useCategoriesQuery("EXPENSE");
  const { data: allLabels = [] } = useLabelsQuery();
  const labels = allLabels.filter((label) => label.applicableTo !== "INCOME");
  const today = accountDateKey(new Date(), user.timezoneOffset);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<PurchaseRows>({
    resolver: zodResolver(cardPurchasesFormSchema),
    defaultValues: { lines: [blankLine(today)] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = watch("lines") ?? [];

  // Lines from one statement usually share a posting date, so a new one starts on the last one's.
  const addLine = () => {
    const current = getValues("lines");
    append(blankLine(current[current.length - 1]?.date || today));
  };

  return (
    <form onSubmit={handleSubmit((data) => onSubmit(data.lines))} noValidate className="space-y-4">
      {/* Every line needs a category, so without the list nothing can be saved: say so. */}
      {categoriesFailed && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-expense/10 px-4 py-2 text-sm text-expense">
          <span>Couldn&apos;t load your categories, so these purchases can&apos;t be saved yet.</span>
          <button type="button" onClick={() => refetchCategories()} className="min-h-11 shrink-0 font-medium underline">
            Retry
          </button>
        </div>
      )}
      {fields.map((row, index) => (
        <PurchaseLineFields
          key={row.id}
          index={index}
          register={register}
          setValue={setValue}
          errors={errors.lines}
          categories={categories}
          loadingCategories={loadingCategories}
          labels={labels}
          selectedLabelIds={lines[index]?.labelIds ?? []}
          onRemove={fields.length > 1 ? () => remove(index) : undefined}
        />
      ))}

      {fields.length < MAX_BATCH_TRANSACTIONS && (
        <button
          type="button"
          onClick={addLine}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-cream-300 text-sm font-medium text-warm-500 transition-colors hover:border-amber/40"
        >
          <Plus className="h-4 w-4" />
          Add another line
        </button>
      )}

      <div className="flex items-center justify-between rounded-xl bg-cream-100 px-4 py-3 text-sm">
        <span className="text-warm-500">
          Total of {fields.length} {fields.length === 1 ? "purchase" : "purchases"}
        </span>
        <span data-testid="purchases-total" className="font-medium text-warm-700">
          {formatCurrency(purchasesTotal(lines), user.currency)}
        </span>
      </div>

      <FormActions onCancel={onCancel} submitting={isSubmitting} submitLabel="Add Purchases" />
    </form>
  );
}
