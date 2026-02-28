"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations";
import { Lock, Eye, EyeOff, Wallet } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token },
  });

  const onSubmit = async (data: ResetPasswordInput) => {
    setError("");

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const body = await res.json();

      if (!res.ok) {
        setError(body.error || "Something went wrong");
        return;
      }

      router.push("/login?reset=true");
    } catch {
      setError("Something went wrong. Please try again.");
    }
  };

  if (!token) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <div className="text-center mb-8">
          <h1 className="font-serif text-3xl text-warm-700">Invalid Link</h1>
          <p className="text-warm-400 mt-1">This reset link is missing or invalid.</p>
        </div>
        <div className="card p-8 grain-overlay text-center">
          <p className="text-warm-600 mb-4">
            Please request a new password reset link.
          </p>
          <Link
            href="/forgot-password"
            className="text-amber hover:text-amber-dark font-medium transition-colors"
          >
            Request new link
          </Link>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      {/* Logo */}
      <div className="text-center mb-8">
        <motion.div
          className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber text-white shadow-soft-md mb-4"
          initial={{ scale: 0.5, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
        >
          <Wallet className="w-8 h-8" />
        </motion.div>
        <h1 className="font-serif text-3xl text-warm-700">New Password</h1>
        <p className="text-warm-400 mt-1">Choose a new password for your account.</p>
      </div>

      {/* Card */}
      <div className="card p-8 grain-overlay">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <input type="hidden" {...register("token")} />

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="bg-expense-light border border-expense/20 text-expense-dark px-4 py-3 rounded-xl text-sm"
            >
              {error}
            </motion.div>
          )}

          <div>
            <label className="block text-sm font-medium text-warm-600 mb-1.5">
              New Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                {...register("password")}
                className="w-full px-4 py-3 pr-12 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
                placeholder="Min 6 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-warm-300 hover:text-warm-500 transition-colors"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {errors.password && (
              <p className="text-expense text-sm mt-1">{errors.password.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-warm-600 mb-1.5">
              Confirm Password
            </label>
            <input
              type="password"
              {...register("confirmPassword")}
              className="w-full px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
              placeholder="Repeat your password"
            />
            {errors.confirmPassword && (
              <p className="text-expense text-sm mt-1">{errors.confirmPassword.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-amber hover:bg-amber-dark text-white font-medium py-3 rounded-xl transition-all duration-200 shadow-soft hover:shadow-soft-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Lock className="w-5 h-5" />
                Reset Password
              </>
            )}
          </button>
        </form>
      </div>
    </motion.div>
  );
}
