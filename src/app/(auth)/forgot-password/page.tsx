"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validations";
import { Mail, ArrowLeft, Wallet } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordInput) => {
    setError("");

    try {
      const res = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json();
        setError(body.error || "Something went wrong");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    }
  };

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
        <h1 className="font-serif text-3xl text-warm-700">Reset Password</h1>
        <p className="text-warm-400 mt-1">
          {submitted
            ? "Check your email for a reset link."
            : "Enter your email to receive a reset link."}
        </p>
      </div>

      {/* Card */}
      <div className="card p-8 grain-overlay">
        {submitted ? (
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber/10 text-amber mb-4">
              <Mail className="w-7 h-7" />
            </div>
            <p className="text-warm-600 mb-2">
              If an account exists with that email, we&apos;ve sent a password reset link.
            </p>
            <p className="text-sm text-warm-400 mb-6">
              The link expires in 1 hour.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 text-amber hover:text-amber-dark font-medium transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to login
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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
                  Email
                </label>
                <input
                  type="email"
                  {...register("email")}
                  className="w-full px-4 py-3 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 placeholder:text-warm-300 focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
                  placeholder="you@example.com"
                />
                {errors.email && (
                  <p className="text-expense text-sm mt-1">{errors.email.message}</p>
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
                    <Mail className="w-5 h-5" />
                    Send Reset Link
                  </>
                )}
              </button>
            </form>

            <p className="text-center text-sm text-warm-400 mt-6">
              <Link
                href="/login"
                className="inline-flex items-center gap-1 text-amber hover:text-amber-dark font-medium transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to login
              </Link>
            </p>
          </>
        )}
      </div>
    </motion.div>
  );
}
