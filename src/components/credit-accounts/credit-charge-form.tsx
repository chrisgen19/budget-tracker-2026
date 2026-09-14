"use client";

import { useFieldArray, useForm, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import {
  createCreditChargesSchema,
  MAX_CREDIT_CHARGES,
  type CreditChargeInput,
} from "@/lib/validations";
import { formatCurrency } from "@/lib/utils";
import { accountDateKey } from "@/lib/account-time";
import { CARD_PAYMENT_CATEGORY_NAME } from "@/lib/card-payment-category";
import { useUser } from "@/components/user-provider";
import { useCategoriesQuery } from "@/hooks/use-categories";
import {
  Field,
  FormActions,
  INPUT_CLASS,
  optionalNumber,
} from "@/components/credit-accounts/form-parts";
import type { CreditChargeView } from "@/hooks/use-credit-accounts";
import type { Category } from "@/types";

interface ChargeRows {
  charges: CreditChargeInput[];
}

/** What the lines add to the card: charges less refunds, summed in cents. Blank amounts add nothing. */
export const statementTotal = (
  rows: readonly { kind?: string; amount?: number | null }[]
): number => {
  const cents = rows.reduce((sum, row) => {
    const amount = typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : 0;
    const rounded = Math.round(amount * 100);
    return sum + (row.kind === "CREDIT" ? -rounded : rounded);
  }, 0);
  return cents / 100;
};

/** A stored charge as the form edits it: its day in the account's timezone, not UTC's. */
export const chargeToInput = (charge: CreditChargeView, timezoneOffset: number): CreditChargeInput => ({
  kind: charge.kind,
  amount: charge.amount,
  description: charge.description,
  date: accountDateKey(charge.date, timezoneOffset),
  categoryId: charge.categoryId,
  originalAmount: charge.originalAmount,
  originalCurrency: charge.originalCurrency,
});

const blankRow = (date: string): CreditChargeInput => ({
  kind: "CHARGE",
  // Undefined rather than 0 or NaN, so the field renders empty instead of "0" or "NaN".
  amount: undefined as unknown as number,
  description: "",
  date,
  categoryId: "",
  originalAmount: null,
  originalCurrency: null,
});

interface ChargeRowProps {
  index: number;
  register: UseFormRegister<ChargeRows>;
  errors: FieldErrors<ChargeRows>["charges"];
  categories: Category[];
  onRemove?: () => void;
}

function ChargeRowFields({ index, register, errors, categories, onRemove }: ChargeRowProps) {
  const rowErrors = errors?.[index];
  const field = (name: keyof CreditChargeInput) => `charges.${index}.${name}` as const;

  return (
    <fieldset className="space-y-3 rounded-xl border border-cream-300/60 p-3">
      <legend className="sr-only">Line {index + 1}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date" error={rowErrors?.date?.message}>
          <input type="date" {...register(field("date"))} className={INPUT_CLASS} />
        </Field>
        <Field label="Type">
          <select {...register(field("kind"))} className={INPUT_CLASS}>
            <option value="CHARGE">Charge</option>
            <option value="CREDIT">Refund</option>
          </select>
        </Field>
      </div>
      <Field label="Description" error={rowErrors?.description?.message}>
        <input type="text" {...register(field("description"))} className={INPUT_CLASS} placeholder="e.g. Google One" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Category" error={rowErrors?.categoryId?.message}>
          <select {...register(field("categoryId"))} className={INPUT_CLASS}>
            <option value="">Choose…</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount" error={rowErrors?.amount ? "Enter an amount above 0" : undefined}>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            {...register(field("amount"), { setValueAs: optionalNumber })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Foreign amount" hint="Optional" error={rowErrors?.originalAmount?.message}>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            {...register(field("originalAmount"), { setValueAs: optionalNumber })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Currency" hint="e.g. USD" error={rowErrors?.originalCurrency?.message}>
          <input
            type="text"
            maxLength={3}
            autoCapitalize="characters"
            {...register(field("originalCurrency"), {
              setValueAs: (value: unknown) =>
                typeof value === "string" && value.trim() !== "" ? value : null,
            })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
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

interface CreditChargeFormProps {
  /** Editing one stored line: a single row, with no adding or removing. */
  initial?: CreditChargeInput;
  onSubmit: (charges: CreditChargeInput[]) => Promise<void>;
  onCancel: () => void;
}

/**
 * Statement lines, several at a time.
 *
 * The running total is there to be checked against the statement's printed total before saving,
 * since a mistyped line is far easier to find now than after it has moved the balance.
 */
export function CreditChargeForm({ initial, onSubmit, onCancel }: CreditChargeFormProps) {
  const { user } = useUser();
  const { data: expenseCategories = [] } = useCategoriesQuery("EXPENSE");
  // A charge is spending on the card, never the payment of it.
  const categories = expenseCategories.filter((c) => c.name !== CARD_PAYMENT_CATEGORY_NAME);
  const today = accountDateKey(new Date(), user.timezoneOffset);

  const {
    register,
    control,
    handleSubmit,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ChargeRows>({
    resolver: zodResolver(createCreditChargesSchema),
    defaultValues: { charges: [initial ?? blankRow(today)] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "charges" });
  const total = statementTotal(watch("charges") ?? []);

  // A statement's lines usually share a posting date, so a new line starts on the last one's.
  const addLine = () => {
    const rows = getValues("charges");
    append(blankRow(rows[rows.length - 1]?.date || today));
  };

  return (
    <form onSubmit={handleSubmit((data) => onSubmit(data.charges))} noValidate className="space-y-4">
      {fields.map((row, index) => (
        <ChargeRowFields
          key={row.id}
          index={index}
          register={register}
          errors={errors.charges}
          categories={categories}
          onRemove={!initial && fields.length > 1 ? () => remove(index) : undefined}
        />
      ))}

      {!initial && fields.length < MAX_CREDIT_CHARGES && (
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
          {initial ? "Amount" : `Total of ${fields.length} ${fields.length === 1 ? "line" : "lines"}`}
        </span>
        <span data-testid="statement-total" className="font-medium text-warm-700">
          {formatCurrency(total, user.currency)}
        </span>
      </div>

      <FormActions
        onCancel={onCancel}
        submitting={isSubmitting}
        submitLabel={initial ? "Save Charge" : "Add Charges"}
      />
    </form>
  );
}
