"use client";

import { useForm } from "react-hook-form";
import { Check, Loader2 } from "lucide-react";
import { type ChangePasswordInput } from "@/lib/validations";

const INPUT_CLASS =
  "w-full px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all";

interface PasswordFormProps {
  form: ReturnType<typeof useForm<ChangePasswordInput>>;
  onSubmit: (data: ChangePasswordInput) => Promise<void>;
  success: string;
  error: string;
}

export function PasswordForm({ form, onSubmit, success, error }: PasswordFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="font-serif text-lg text-warm-700">Change Password</h2>
        <p className="text-sm text-warm-400 mt-0.5">
          Update your password to keep your account secure
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Current Password
          </label>
          <input
            type="password"
            {...register("currentPassword")}
            className={INPUT_CLASS}
            placeholder="Enter current password"
          />
          {errors.currentPassword && (
            <p className="text-expense text-sm mt-1">
              {errors.currentPassword.message}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            New Password
          </label>
          <input
            type="password"
            {...register("newPassword")}
            className={INPUT_CLASS}
            placeholder="Enter new password"
          />
          {errors.newPassword && (
            <p className="text-expense text-sm mt-1">
              {errors.newPassword.message}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-warm-600 mb-1.5">
            Confirm New Password
          </label>
          <input
            type="password"
            {...register("confirmPassword")}
            className={INPUT_CLASS}
            placeholder="Confirm new password"
          />
          {errors.confirmPassword && (
            <p className="text-expense text-sm mt-1">
              {errors.confirmPassword.message}
            </p>
          )}
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
              "Change Password"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
