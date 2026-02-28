"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, RefreshCw, Wallet } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [resendError, setResendError] = useState("");

  const handleResend = async () => {
    if (!email) return;

    setResending(true);
    setResendMessage("");
    setResendError("");

    try {
      const res = await fetch("/api/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const body = await res.json();

      if (!res.ok) {
        setResendError(body.error || "Failed to resend");
      } else {
        setResendMessage("Verification email sent! Check your inbox.");
      }
    } catch {
      setResendError("Something went wrong. Please try again.");
    } finally {
      setResending(false);
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
        <h1 className="font-serif text-3xl text-warm-700">Check your email</h1>
        <p className="text-warm-400 mt-1">We&apos;ve sent a verification link.</p>
      </div>

      {/* Card */}
      <div className="card p-8 grain-overlay text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber/10 text-amber mb-4">
          <Mail className="w-7 h-7" />
        </div>

        <p className="text-warm-600 mb-2">
          We sent a verification email to:
        </p>
        {email && (
          <p className="font-medium text-warm-700 mb-6">{email}</p>
        )}
        <p className="text-sm text-warm-400 mb-6">
          Click the link in the email to verify your account. The link expires in 24 hours.
        </p>

        {resendMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="bg-income-light border border-income/20 text-income-dark px-4 py-3 rounded-xl text-sm mb-4"
          >
            {resendMessage}
          </motion.div>
        )}

        {resendError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="bg-expense-light border border-expense/20 text-expense-dark px-4 py-3 rounded-xl text-sm mb-4"
          >
            {resendError}
          </motion.div>
        )}

        <button
          onClick={handleResend}
          disabled={resending || !email}
          className="w-full bg-amber hover:bg-amber-dark text-white font-medium py-3 rounded-xl transition-all duration-200 shadow-soft hover:shadow-soft-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-4"
        >
          {resending ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <RefreshCw className="w-5 h-5" />
              Resend verification email
            </>
          )}
        </button>

        <p className="text-center text-sm text-warm-400">
          Already verified?{" "}
          <Link
            href="/login"
            className="text-amber hover:text-amber-dark font-medium transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    </motion.div>
  );
}
