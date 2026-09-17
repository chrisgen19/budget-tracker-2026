"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  savingsGoalContributionSchema,
  type SavingsGoalContributionInput,
} from "@/lib/validations";
import { cn, getCurrencySymbol } from "@/lib/utils";
import { accountDateKey } from "@/lib/account-time";
import { useUser } from "@/components/user-provider";
import { Field, FormActions, INPUT_CLASS } from "@/components/credit-accounts/form-parts";

interface ContributionFormProps {
  goalName: string;
  onSubmit: (data: SavingsGoalContributionInput) => Promise<void>;
  onCancel: () => void;
}

/**
 * Putting money into a goal, or taking it back out.
 *
 * Direction is a pair of buttons rather than a minus sign the user has to remember to type. The
 * stored column is signed - funded is its sum - so the form's job is to make the sign impossible
 * to get wrong, not to expose it.
 *
 * It is component state rather than a form field because it is not part of the payload: the schema
 * validates one signed amount, and adding a second field for the sign would let the two disagree.
 */
export function ContributionForm({ goalName, onSubmit, onCancel }: ContributionFormProps) {
  const { user } = useUser();
  const symbol = getCurrencySymbol(user.currency);
  const [direction, setDirection] = useState<"in" | "out">("in");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SavingsGoalContributionInput>({
    resolver: zodResolver(savingsGoalContributionSchema),
    defaultValues: {
      amount: 0,
      date: accountDateKey(new Date(), user.timezoneOffset),
      note: null,
    },
  });

  const submit = handleSubmit((values) =>
    onSubmit({
      ...values,
      amount: direction === "out" ? -Math.abs(values.amount) : Math.abs(values.amount),
    }),
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <p className="text-sm text-warm-500">
        Assigning money to <span className="font-medium text-warm-700">{goalName}</span>.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {(["in", "out"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={direction === option}
            onClick={() => setDirection(option)}
            className={cn(
              "min-h-11 rounded-xl border text-sm font-medium transition-colors",
              direction === option
                ? option === "in"
                  ? "border-income bg-income-light text-income-dark"
                  : "border-expense bg-expense-light text-expense-dark"
                : "border-cream-300 text-warm-500 hover:bg-cream-100",
            )}
          >
            {option === "in" ? "Put in" : "Take out"}
          </button>
        ))}
      </div>

      <Field label="Amount" hint={symbol} error={errors.amount?.message}>
        <input
          type="number"
          step="0.01"
          inputMode="decimal"
          {...register("amount", { valueAsNumber: true })}
          className={INPUT_CLASS}
          placeholder="0.00"
        />
      </Field>

      <Field label="Date" error={errors.date?.message}>
        <input type="date" {...register("date")} className={INPUT_CLASS} />
      </Field>

      <Field label="Note" hint="Optional" error={errors.note?.message}>
        <input
          type="text"
          {...register("note", { setValueAs: (value) => (value === "" ? null : value) })}
          className={INPUT_CLASS}
          placeholder="e.g. Transferred from payroll"
        />
      </Field>

      <FormActions onCancel={onCancel} submitting={isSubmitting} submitLabel="Save" />
    </form>
  );
}
