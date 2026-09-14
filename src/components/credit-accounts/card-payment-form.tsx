"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { creditPaymentSchema, type CreditPaymentInput } from "@/lib/validations";
import { cn, getCurrencySymbol } from "@/lib/utils";
import { accountDateKey } from "@/lib/account-time";
import { useUser } from "@/components/user-provider";
import {
  Field,
  FormActions,
  INPUT_CLASS,
  optionalNumber,
} from "@/components/credit-accounts/form-parts";

const KINDS = [
  { value: "PAYMENT", label: "Payment", hint: "Money sent to the card from the bank" },
  { value: "CREDIT", label: "Refund", hint: "A refund or reversal the card issued" },
] as const;

interface CardPaymentFormProps {
  /** A stored payment being corrected. */
  initial?: CreditPaymentInput;
  /** What a new payment starts at, usually what the card owes. */
  defaultAmount?: number;
  onSubmit: (input: CreditPaymentInput) => Promise<void>;
  onCancel: () => void;
}

/**
 * Record money that lowered what a card owes. Not an expense: the purchases it pays for were counted
 * when they were made, so logging the payment as spending too would count the same money twice.
 */
export function CardPaymentForm({ initial, defaultAmount, onSubmit, onCancel }: CardPaymentFormProps) {
  const { user } = useUser();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreditPaymentInput>({
    resolver: zodResolver(creditPaymentSchema),
    defaultValues: initial ?? {
      kind: "PAYMENT",
      amount: defaultAmount && defaultAmount > 0 ? defaultAmount : (undefined as unknown as number),
      description: "",
      date: accountDateKey(new Date(), user.timezoneOffset),
    },
  });
  const kind = watch("kind");

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div role="radiogroup" aria-label="Kind" className="flex gap-1 rounded-xl bg-cream-100 p-1">
        {KINDS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={kind === option.value}
            onClick={() => setValue("kind", option.value)}
            className={cn(
              "min-h-11 flex-1 rounded-lg text-sm font-medium transition-colors",
              kind === option.value ? "bg-white text-warm-700 shadow-warm" : "text-warm-400 hover:text-warm-600"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="-mt-3 text-xs text-warm-400">{KINDS.find((k) => k.value === kind)?.hint}</p>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Amount (${getCurrencySymbol(user.currency)})`} error={errors.amount ? "Enter an amount above 0" : undefined}>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            {...register("amount", { setValueAs: optionalNumber })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Date" error={errors.date?.message}>
          <input type="date" {...register("date")} className={INPUT_CLASS} />
        </Field>
      </div>

      <Field label="Note" hint="Optional" error={errors.description?.message}>
        <input type="text" {...register("description")} className={INPUT_CLASS} placeholder="e.g. BPI app transfer" />
      </Field>

      <FormActions onCancel={onCancel} submitting={isSubmitting} submitLabel={initial ? "Save" : "Record"} />
    </form>
  );
}
