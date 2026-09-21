"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import { cardInterestSchema, type CardInterestInput } from "@/lib/validations";
import { INTEREST_CATEGORY_NAME } from "@/lib/card-interest";
import { cn, getCurrencySymbol } from "@/lib/utils";
import { accountDateKey } from "@/lib/account-time";
import { useUser } from "@/components/user-provider";
import { useCategoriesQuery } from "@/hooks/use-categories";
import {
  Field,
  FormActions,
  INPUT_CLASS,
  optionalNumber,
} from "@/components/credit-accounts/form-parts";

const KINDS = [
  { value: "Interest charge", label: "Interest", hint: "What the bank charged for carrying a balance" },
  { value: "Card fee", label: "Fee", hint: "An annual fee, late fee or other charge on the card" },
] as const;

interface CardInterestFormProps {
  onSubmit: (input: CardInterestInput) => Promise<void>;
  onCancel: () => void;
}

/**
 * Log interest or a fee charged on a card.
 *
 * It writes an ordinary EXPENSE transaction on the card rather than a row of its own, so it reaches
 * every category and label report the day it was charged. Without it, interest raises the real
 * balance while `computeAccountBalance` knows nothing about it, and the card's derived balance
 * drifts further below the statement every cycle.
 */
export function CardInterestForm({ onSubmit, onCancel }: CardInterestFormProps) {
  const { user } = useUser();
  const categories = useCategoriesQuery("EXPENSE");
  const expenseCategories = categories.data ?? [];
  const seeded = expenseCategories.find((category) => category.name === INTEREST_CATEGORY_NAME);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CardInterestInput>({
    resolver: zodResolver(cardInterestSchema),
    defaultValues: {
      date: accountDateKey(new Date(), user.timezoneOffset),
      description: KINDS[0].value,
      categoryId: "",
      amount: undefined as unknown as number,
    },
  });

  // The categories arrive after the first render, so the default is applied once they do rather
  // than baked into defaultValues, where it would always be empty.
  useEffect(() => {
    if (seeded) setValue("categoryId", seeded.id, { shouldValidate: false });
  }, [seeded, setValue]);

  const description = watch("description");
  // Classification is by category name, so what matters is the category actually chosen, not
  // whether the seeded one happens to exist. Picking any other one saves a charge that moves the
  // balance and is counted as interest nowhere.
  const selected = expenseCategories.find((category) => category.id === watch("categoryId"));
  const countsAsInterest = selected?.name === INTEREST_CATEGORY_NAME;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <div role="radiogroup" aria-label="Kind" className="flex gap-1 rounded-xl bg-cream-100 p-1">
        {KINDS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={description === option.value}
            onClick={() => setValue("description", option.value)}
            className={cn(
              "min-h-11 flex-1 rounded-lg text-sm font-medium transition-colors",
              description === option.value ? "bg-white text-warm-700 shadow-warm" : "text-warm-400 hover:text-warm-600"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="-mt-3 text-xs text-warm-400">
        {KINDS.find((k) => k.value === description)?.hint ?? "Charged on the card by the bank"}
      </p>

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

      <Field label="Description" error={errors.description?.message}>
        <input type="text" {...register("description")} className={INPUT_CLASS} />
      </Field>

      <Field label="Category" error={errors.categoryId?.message}>
        <select {...register("categoryId")} className={INPUT_CLASS} disabled={categories.isLoading || categories.isError}>
          <option value="">
            {categories.isLoading ? "Loading categories…" : categories.isError ? "Unavailable" : "Choose a category"}
          </option>
          {expenseCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>

      {/* A failed load leaves the select empty and `seeded` undefined, which is indistinguishable
          from a database that has not been seeded. Sending someone to run a seed over what is
          actually a dropped request is the wrong instruction, so the error takes precedence. */}
      {categories.isError ? (
        <div className="flex items-start gap-2 rounded-xl border border-expense/20 bg-expense-light/40 p-3 text-xs text-warm-600">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-expense" />
          <div className="space-y-1">
            <p>Couldn&apos;t load your categories, so there is nothing to file this charge under.</p>
            <button
              type="button"
              onClick={() => void categories.refetch()}
              disabled={categories.isFetching}
              className="min-h-11 text-sm font-medium text-amber-dark disabled:opacity-50"
            >
              {categories.isFetching ? "Retrying…" : "Try again"}
            </button>
          </div>
        </div>
      ) : (
        // The charge saves either way and moves the balance. What it will not do is show up as
        // interest, and a form named after interest must not stay quiet about that.
        !categories.isLoading &&
        !countsAsInterest && (
          <p className="flex items-start gap-2 rounded-xl border border-amber/30 bg-amber/10 p-3 text-xs text-warm-600">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-dark" />
            <span>
              {seeded ? (
                <>
                  This will be filed under {selected ? `“${selected.name}”` : "another category"} and
                  counted as ordinary spending, not as interest. Choose &ldquo;{INTEREST_CATEGORY_NAME}
                  &rdquo; to have it counted.
                </>
              ) : (
                <>
                  There is no &ldquo;{INTEREST_CATEGORY_NAME}&rdquo; category yet, so this charge will not
                  be counted as interest. Run the category seed, then move it across.
                </>
              )}
            </span>
          </p>
        )
      )}

      <FormActions onCancel={onCancel} submitting={isSubmitting} submitLabel="Log charge" />
    </form>
  );
}
