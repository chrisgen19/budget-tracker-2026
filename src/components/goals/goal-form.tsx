"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { savingsGoalSchema, type SavingsGoalInput } from "@/lib/validations";
import { cn, getCurrencySymbol } from "@/lib/utils";
import { useUser } from "@/components/user-provider";
import { Field, FormActions, INPUT_CLASS } from "@/components/credit-accounts/form-parts";
import type { SavingsGoalSummary } from "@/types";

interface GoalFormProps {
  goal?: SavingsGoalSummary | null;
  onSubmit: (data: SavingsGoalInput) => Promise<void>;
  onCancel: () => void;
}

const KINDS: ReadonlyArray<{ value: SavingsGoalInput["kind"]; label: string; hint: string }> = [
  { value: "GOAL", label: "Goal", hint: "A one-off sum to reach by a date." },
  { value: "SINKING_FUND", label: "Sinking fund", hint: "An expense you save for a slice at a time." },
];

export function GoalForm({ goal, onSubmit, onCancel }: GoalFormProps) {
  const { user } = useUser();
  const symbol = getCurrencySymbol(user.currency);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SavingsGoalInput>({
    resolver: zodResolver(savingsGoalSchema),
    defaultValues: {
      name: goal?.name ?? "",
      kind: goal?.kind ?? "GOAL",
      targetAmount: goal?.targetAmount ?? 0,
      targetDate: goal?.targetDate ?? null,
      notes: goal?.notes ?? null,
    },
  });
  const kind = watch("kind");

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <Field label="What are you saving for?" error={errors.name?.message}>
        <input type="text" {...register("name")} className={INPUT_CLASS} placeholder="e.g. House deposit" />
      </Field>

      <div>
        <p className="mb-2 text-sm font-medium text-warm-600">Kind</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={kind === option.value}
              onClick={() => setValue("kind", option.value)}
              className={cn(
                "min-h-11 rounded-xl border p-3 text-left transition-colors",
                kind === option.value
                  ? "border-amber bg-amber-light/50 text-warm-700"
                  : "border-cream-300 text-warm-500 hover:bg-cream-100",
              )}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-0.5 block text-xs text-warm-400">{option.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <Field label="Target amount" hint={symbol} error={errors.targetAmount?.message}>
        <input
          type="number"
          step="0.01"
          inputMode="decimal"
          {...register("targetAmount", { valueAsNumber: true })}
          className={INPUT_CLASS}
          placeholder="0.00"
        />
      </Field>

      {/*
        Optional on purpose. A goal with no deadline is a real thing people have, and the pace
        arithmetic reports progress and stays quiet about "on track" rather than inventing a date
        to measure against. An empty field is sent as `null`, not as "".
      */}
      <Field label="By when" hint="Optional" error={errors.targetDate?.message}>
        <input
          type="date"
          {...register("targetDate", { setValueAs: (value) => (value === "" ? null : value) })}
          className={INPUT_CLASS}
        />
      </Field>

      <Field label="Notes" hint="Optional" error={errors.notes?.message}>
        <textarea
          rows={2}
          {...register("notes", { setValueAs: (value) => (value === "" ? null : value) })}
          className={INPUT_CLASS}
          placeholder="What this is for, or where the money lives."
        />
      </Field>

      <FormActions
        onCancel={onCancel}
        submitting={isSubmitting}
        submitLabel={goal ? "Save goal" : "Create goal"}
      />
    </form>
  );
}
