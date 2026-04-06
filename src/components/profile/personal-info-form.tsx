"use client";

import { useForm } from "react-hook-form";
import { Check, Loader2 } from "lucide-react";
import { type UpdateProfileInput } from "@/lib/validations";

const CURRENCIES = [
  { value: "PHP", label: "PHP - Philippine Peso" },
  { value: "USD", label: "USD - US Dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "GBP", label: "GBP - British Pound" },
  { value: "JPY", label: "JPY - Japanese Yen" },
  { value: "AUD", label: "AUD - Australian Dollar" },
  { value: "CAD", label: "CAD - Canadian Dollar" },
  { value: "SGD", label: "SGD - Singapore Dollar" },
  { value: "KRW", label: "KRW - South Korean Won" },
  { value: "INR", label: "INR - Indian Rupee" },
];

const TIMEZONES = [
  { value: 720, label: "UTC-12:00" },
  { value: 660, label: "UTC-11:00" },
  { value: 600, label: "UTC-10:00 (Honolulu)" },
  { value: 540, label: "UTC-09:00 (Anchorage)" },
  { value: 480, label: "UTC-08:00 (Los Angeles)" },
  { value: 420, label: "UTC-07:00 (Denver)" },
  { value: 360, label: "UTC-06:00 (Chicago)" },
  { value: 300, label: "UTC-05:00 (New York)" },
  { value: 240, label: "UTC-04:00 (Halifax)" },
  { value: 180, label: "UTC-03:00 (São Paulo)" },
  { value: 120, label: "UTC-02:00" },
  { value: 60, label: "UTC-01:00" },
  { value: 0, label: "UTC+00:00 (London)" },
  { value: -60, label: "UTC+01:00 (Paris)" },
  { value: -120, label: "UTC+02:00 (Cairo)" },
  { value: -180, label: "UTC+03:00 (Moscow)" },
  { value: -240, label: "UTC+04:00 (Dubai)" },
  { value: -300, label: "UTC+05:00 (Karachi)" },
  { value: -330, label: "UTC+05:30 (Mumbai)" },
  { value: -345, label: "UTC+05:45 (Kathmandu)" },
  { value: -360, label: "UTC+06:00 (Dhaka)" },
  { value: -420, label: "UTC+07:00 (Bangkok)" },
  { value: -480, label: "UTC+08:00 (Manila)" },
  { value: -540, label: "UTC+09:00 (Tokyo)" },
  { value: -570, label: "UTC+09:30 (Adelaide)" },
  { value: -600, label: "UTC+10:00 (Sydney)" },
  { value: -660, label: "UTC+11:00" },
  { value: -720, label: "UTC+12:00 (Auckland)" },
  { value: -780, label: "UTC+13:00 (Samoa)" },
];

const INPUT_CLASS =
  "w-full px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all";

interface PersonalInfoFormProps {
  form: ReturnType<typeof useForm<UpdateProfileInput>>;
  onSubmit: (data: UpdateProfileInput) => Promise<void>;
  success: string;
  error: string;
}

export function PersonalInfoForm({ form, onSubmit, success, error }: PersonalInfoFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="font-serif text-lg text-warm-700">Personal Information</h2>
        <p className="text-sm text-warm-400 mt-0.5">
          Update your name, email, currency, and timezone
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Name
          </label>
          <input
            type="text"
            {...register("name")}
            className={INPUT_CLASS}
            placeholder="Your name"
          />
          {errors.name && (
            <p className="text-expense text-sm mt-1">{errors.name.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Email
          </label>
          <input
            type="email"
            {...register("email")}
            className={INPUT_CLASS}
            placeholder="your@email.com"
          />
          {errors.email && (
            <p className="text-expense text-sm mt-1">{errors.email.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Currency
          </label>
          <select
            {...register("currency")}
            className={INPUT_CLASS}
          >
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {errors.currency && (
            <p className="text-expense text-sm mt-1">{errors.currency.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Timezone
          </label>
          <select
            {...register("timezoneOffset", { valueAsNumber: true })}
            className={INPUT_CLASS}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>

        {success && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-income-light border border-income/20 text-income-dark text-sm">
            <Check className="w-4 h-4" />
            {success}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-expense-light border border-expense/20 text-expense-dark text-sm">
            {error}
          </div>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-amber hover:bg-amber-dark text-white font-medium text-sm transition-colors shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
