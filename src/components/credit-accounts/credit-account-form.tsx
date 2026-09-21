"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { creditAccountSchema, type CreditAccountInput } from "@/lib/validations";
import { cn, getCurrencySymbol } from "@/lib/utils";
import { accountDateKey } from "@/lib/account-time";
import { useUser } from "@/components/user-provider";
import {
  Field,
  FormActions,
  INPUT_CLASS,
  optionalNumber,
} from "@/components/credit-accounts/form-parts";
import type { CreditAccountView } from "@/hooks/use-credit-accounts";

const CARD_COLORS = [
  "#5B6B8C", "#E07C4F", "#5B8DEF", "#8B6FC0",
  "#2D8B5A", "#E05B8D", "#C8702A", "#8B7E6A",
];

interface CreditAccountFormProps {
  account?: CreditAccountView | null;
  onSubmit: (data: CreditAccountInput) => Promise<void>;
  onCancel: () => void;
}

export function CreditAccountForm({ account, onSubmit, onCancel }: CreditAccountFormProps) {
  const { user } = useUser();
  const symbol = getCurrencySymbol(user.currency);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreditAccountInput>({
    resolver: zodResolver(creditAccountSchema),
    defaultValues: {
      name: account?.name ?? "",
      color: account?.color ?? CARD_COLORS[0],
      creditLimit: account?.creditLimit ?? null,
      statementDay: account?.statementDay ?? null,
      dueDay: account?.dueDay ?? null,
      apr: account?.apr ?? null,
      minimumPaymentPct: account?.minimumPaymentPct ?? null,
      minimumPaymentFloor: account?.minimumPaymentFloor ?? null,
      plannedPayment: account?.plannedPayment ?? null,
      openingBalance: account?.openingBalance ?? 0,
      // The account's own calendar day, not the browser's: the server stores this as the start of
      // that day in the account timezone.
      openingBalanceDate: accountDateKey(
        account?.openingBalanceDate ?? new Date(),
        user.timezoneOffset
      ),
    },
  });
  const selectedColor = watch("color");
  // Open on edit when the card already carries any of these. Collapsed, the section's own copy
  // reads "Leave blank if you pay this card in full", so a saved 36% APR looks like it never saved.
  const hasTerms =
    account != null &&
    [account.apr, account.minimumPaymentPct, account.minimumPaymentFloor, account.plannedPayment].some(
      (value) => value != null
    );

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <Field label="Card name" error={errors.name?.message}>
        <input
          type="text"
          {...register("name")}
          className={INPUT_CLASS}
          placeholder="e.g. BPI Credit Card"
        />
      </Field>

      <div>
        <p className="mb-2 text-sm font-medium text-warm-600">Color</p>
        <div className="flex flex-wrap gap-2.5">
          {CARD_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Use color ${color}`}
              aria-pressed={selectedColor === color}
              onClick={() => setValue("color", color)}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-xl transition-all",
                selectedColor === color ? "ring-2 ring-offset-2 ring-warm-400" : "hover:scale-105"
              )}
              style={{ backgroundColor: color }}
            >
              {selectedColor === color && <Check className="h-4 w-4 text-white drop-shadow-sm" />}
            </button>
          ))}
        </div>
      </div>

      <Field label={`Credit limit (${symbol})`} hint="Optional" error={errors.creditLimit?.message}>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          {...register("creditLimit", { setValueAs: optionalNumber })}
          className={INPUT_CLASS}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Statement day" hint="1-31" error={errors.statementDay?.message}>
          <input
            type="number"
            inputMode="numeric"
            {...register("statementDay", { setValueAs: optionalNumber })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="Due day" hint="1-31" error={errors.dueDay?.message}>
          <input
            type="number"
            inputMode="numeric"
            {...register("dueDay", { setValueAs: optionalNumber })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={`Already owed (${symbol})`} error={errors.openingBalance?.message}>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            {...register("openingBalance", { setValueAs: (value) => optionalNumber(value) ?? 0 })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="As of" error={errors.openingBalanceDate?.message}>
          <input type="date" {...register("openingBalanceDate")} className={INPUT_CLASS} />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-warm-400">
        What you owed when you started tracking this card. Don&apos;t also add the charges it
        already includes, or they count twice.
      </p>

      {/* Its own section, closed by default: a card paid in full every month needs none of it, and
          these figures are read off a statement rather than remembered. */}
      <details open={hasTerms} className="rounded-xl border border-cream-300 bg-cream-50/40">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium text-warm-600">
          Interest and payments
        </summary>
        <div className="space-y-4 px-4 pb-4">
          <p className="text-xs text-warm-400">
            Optional, and only needed to work out what carrying a balance costs. Leave blank if you
            pay this card in full.
          </p>

          <Field label="APR (%)" hint="Optional" error={errors.apr?.message}>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="e.g. 36"
              {...register("apr", { setValueAs: optionalNumber })}
              className={INPUT_CLASS}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum (%)" hint="Of balance" error={errors.minimumPaymentPct?.message}>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="e.g. 5"
                {...register("minimumPaymentPct", { setValueAs: optionalNumber })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label={`Minimum floor (${symbol})`} hint="Optional" error={errors.minimumPaymentFloor?.message}>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="e.g. 500"
                {...register("minimumPaymentFloor", { setValueAs: optionalNumber })}
                className={INPUT_CLASS}
              />
            </Field>
          </div>
          <p className="-mt-2 text-xs text-warm-400">
            Banks bill whichever of the two is higher. Enter them as your statement words it.
          </p>

          <Field label={`Planned monthly payment (${symbol})`} hint="Optional" error={errors.plannedPayment?.message}>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              {...register("plannedPayment", { setValueAs: optionalNumber })}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      </details>

      <FormActions
        onCancel={onCancel}
        submitting={isSubmitting}
        submitLabel={account ? "Save Card" : "Add Card"}
      />
    </form>
  );
}
