"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { accountSchema, type AccountInput } from "@/lib/validations";
import { getCurrencySymbol, cn } from "@/lib/utils";
import { useUser } from "@/components/user-provider";
import type { AccountBalance } from "@/lib/budget-query-types";

const ACCOUNT_TYPES = [
  { value: "CASH", label: "Cash", hint: "Physical money in your wallet" },
  { value: "BANK", label: "Bank", hint: "Savings or checking account" },
  { value: "CREDIT_CARD", label: "Credit card", hint: "A balance you owe" },
  { value: "EWALLET", label: "E-wallet", hint: "GCash, Maya, and similar" },
] as const;

const PRESET_COLORS = [
  "#8B6FC0", "#2D8B5A", "#E07C4F", "#5B8DEF",
  "#F5A623", "#E05B8D", "#14B8A6", "#8B7E6A",
];

interface AccountFormProps {
  account?: AccountBalance | null;
  onSubmit: (data: AccountInput) => Promise<void>;
  onCancel: () => void;
  error?: string | null;
}

export function AccountForm({ account, onSubmit, onCancel, error }: AccountFormProps) {
  const { user } = useUser();
  const symbol = getCurrencySymbol(user.currency);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AccountInput>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: account?.name ?? "",
      type: account?.type ?? "CASH",
      openingBalance: account?.openingBalance ?? 0,
      creditLimit: account?.creditLimit ?? null,
      color: account?.color ?? PRESET_COLORS[0],
      icon: account?.icon ?? "Wallet",
      isActive: account?.isActive ?? true,
    },
  });

  const selectedType = watch("type");
  const selectedColor = watch("color");
  const isCard = selectedType === "CREDIT_CARD";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <label className="block text-sm font-semibold text-warm-600 mb-2">Name</label>
        <input
          {...register("name")}
          placeholder="BPI Amore Cashback"
          className="w-full px-4 py-3 rounded-xl bg-cream-100 text-warm-700 border border-transparent focus:border-amber-300 focus:outline-none"
        />
        {errors.name && <p className="text-expense text-sm mt-1.5">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-semibold text-warm-600 mb-2">Type</label>
        <div className="grid grid-cols-2 gap-2">
          {ACCOUNT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                setValue("type", t.value);
                // A limit only means something on a card, and the schema rejects one elsewhere.
                if (t.value !== "CREDIT_CARD") setValue("creditLimit", null);
              }}
              className={cn(
                "text-left px-3.5 py-3 rounded-xl border transition-all duration-200",
                selectedType === t.value
                  ? "border-amber-300 bg-amber-50"
                  : "border-cream-200 bg-cream-50 hover:border-cream-300"
              )}
            >
              <span className="block text-sm font-medium text-warm-700">{t.label}</span>
              <span className="block text-xs text-warm-400 mt-0.5">{t.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-warm-600 mb-2">
          {isCard ? "Current balance owed" : "Starting balance"}
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-warm-400">{symbol}</span>
          <input
            type="number"
            step="0.01"
            {...register("openingBalance", {
              // A card's figure is entered as what you *owe* and stored negated, so the data keeps
              // one sign convention (positive is money you have) and only the edges flip it.
              setValueAs: (v) => {
                const n = v === "" || v == null ? 0 : Number(v);
                return Number.isNaN(n) ? 0 : n;
              },
            })}
            className="w-full pl-10 pr-4 py-3 rounded-xl bg-cream-100 text-warm-700 border border-transparent focus:border-amber-300 focus:outline-none"
          />
        </div>
        <p className="text-xs text-warm-400 mt-1.5">
          {isCard
            ? "What you owe on this card today, before any transaction you log here. Enter it as a negative number if the card is in credit."
            : "What this account holds today, before any transaction you log here."}
        </p>
        {errors.openingBalance && (
          <p className="text-expense text-sm mt-1.5">{errors.openingBalance.message}</p>
        )}
      </div>

      {isCard && (
        <div>
          <label className="block text-sm font-semibold text-warm-600 mb-2">
            Credit limit <span className="font-normal text-warm-400">(optional)</span>
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-warm-400">{symbol}</span>
            <input
              type="number"
              step="0.01"
              {...register("creditLimit", {
                setValueAs: (v) => (v === "" || v == null ? null : Number(v)),
              })}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-cream-100 text-warm-700 border border-transparent focus:border-amber-300 focus:outline-none"
            />
          </div>
          {errors.creditLimit && (
            <p className="text-expense text-sm mt-1.5">{errors.creditLimit.message}</p>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold text-warm-600 mb-2">Colour</label>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => setValue("color", c)}
              style={{ backgroundColor: c }}
              className={cn(
                "w-9 h-9 rounded-full transition-transform duration-150",
                selectedColor === c ? "ring-2 ring-offset-2 ring-warm-400 scale-110" : ""
              )}
            />
          ))}
        </div>
      </div>

      {error && <p className="text-expense text-sm">{error}</p>}

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl bg-cream-100 text-warm-600 font-medium hover:bg-cream-200 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 py-3 rounded-xl bg-warm-700 text-cream-50 font-medium hover:bg-warm-800 disabled:opacity-60 transition-colors"
        >
          {isSubmitting ? "Saving…" : account ? "Save changes" : "Add account"}
        </button>
      </div>
    </form>
  );
}
