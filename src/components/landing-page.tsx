"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Wallet,
  BarChart3,
  Tags,
  TrendingUp,
  TrendingDown,
  EyeOff,
  CalendarDays,
  Zap,
  ArrowRight,
  ChevronRight,
  ScanLine,
  Globe,
  Sparkles,
  Check,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Animation variants                                                 */
/* ------------------------------------------------------------------ */

const fadeIn = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: "easeOut" },
  },
};

const fadeInLeft = {
  hidden: { opacity: 0, x: -24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, ease: "easeOut" },
  },
};

const fadeInRight = {
  hidden: { opacity: 0, x: 24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, ease: "easeOut" },
  },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
};

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const features = [
  {
    icon: BarChart3,
    title: "Smart Dashboard",
    description:
      "Income, expenses, and running balance — all in one view, updated in real time.",
    color: "text-amber",
    bg: "bg-amber-light",
  },
  {
    icon: ScanLine,
    title: "Receipt Scanning",
    description:
      "Snap a receipt and AI extracts the amount, date, and category instantly.",
    color: "text-amber-dark",
    bg: "bg-amber-50",
  },
  {
    icon: Tags,
    title: "Category Tracking",
    description:
      "Color-coded categories show exactly where your money flows. Create your own.",
    color: "text-income",
    bg: "bg-income-light",
  },
  {
    icon: TrendingUp,
    title: "Balance Trend",
    description:
      "A 30-day chart shows whether you're building wealth or need to adjust.",
    color: "text-[#3b82f6]",
    bg: "bg-[#3b82f6]/10",
  },
  {
    icon: EyeOff,
    title: "Privacy Mode",
    description:
      "One tap to hide all amounts. Check your budget in public, worry-free.",
    color: "text-warm-500",
    bg: "bg-cream-200",
  },
  {
    icon: Zap,
    title: "Quick Transactions",
    description:
      "Add income or expenses in seconds with personalized quick-access tiles.",
    color: "text-amber",
    bg: "bg-amber-light/60",
  },
  {
    icon: CalendarDays,
    title: "Monthly Navigation",
    description:
      "Browse any month freely. Your running balance always carries over.",
    color: "text-expense",
    bg: "bg-expense-light",
  },
  {
    icon: Globe,
    title: "Multi-Currency",
    description:
      "10+ currencies supported. Your choice reflects across every page and chart.",
    color: "text-income-dark",
    bg: "bg-income-light",
  },
];

const steps = [
  {
    number: "01",
    title: "Create your account",
    description:
      "Sign up for free in 30 seconds. No credit card, no strings attached.",
  },
  {
    number: "02",
    title: "Log your transactions",
    description:
      "Type them in manually or snap a receipt — AI handles the rest.",
  },
  {
    number: "03",
    title: "See the bigger picture",
    description:
      "Charts and trends reveal your spending patterns so you can plan ahead.",
  },
];

/* ------------------------------------------------------------------ */
/*  Landing Page                                                       */
/* ------------------------------------------------------------------ */

export function LandingPage() {
  return (
    <div className="min-h-screen bg-cream-100 overflow-x-hidden">
      {/* Decorative background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-amber-100/30 blur-[100px]" />
        <div className="absolute top-[60vh] -left-40 w-[400px] h-[400px] rounded-full bg-income-light/30 blur-[100px]" />
        <div className="absolute top-[140vh] right-0 w-[500px] h-[400px] rounded-full bg-amber-50/40 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[400px] rounded-full bg-cream-200/40 blur-[120px]" />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-cream-100/70 backdrop-blur-xl border-b border-cream-300/30">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber flex items-center justify-center shadow-warm">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div className="leading-none">
              <span className="font-serif text-lg text-warm-700 block">
                Budget
              </span>
              <span className="text-[10px] font-medium tracking-[0.2em] text-warm-400 uppercase">
                Tracker
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-warm-500 hover:text-warm-700 transition-colors hidden sm:block"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 bg-amber hover:bg-amber-dark text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors shadow-soft"
            >
              Get Started
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-16 sm:pt-40 sm:pb-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div initial="hidden" animate="visible" variants={stagger}>
            <motion.p
              variants={fadeIn}
              className="inline-flex items-center gap-1.5 text-xs font-medium tracking-[0.15em] uppercase text-amber-dark bg-amber-light/60 px-3.5 py-1.5 rounded-full mb-6"
            >
              <Sparkles className="w-3 h-3" />
              Now with AI Receipt Scanning
            </motion.p>

            <motion.h1
              variants={fadeIn}
              className="font-serif text-4xl sm:text-5xl lg:text-6xl text-warm-800 leading-[1.08] mb-6"
            >
              Your Money,{" "}
              <span className="text-amber">Beautifully</span> Organized
            </motion.h1>

            <motion.p
              variants={fadeIn}
              className="text-warm-400 text-lg sm:text-xl max-w-xl mx-auto mb-10 leading-relaxed"
            >
              Track spending, snap receipts, and watch your balance grow — all
              in a warm, personal space designed to make budgeting feel
              effortless.
            </motion.p>

            <motion.div
              variants={fadeIn}
              className="flex items-center justify-center gap-4"
            >
              <Link
                href="/register"
                className="inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium px-6 py-3 rounded-xl transition-all shadow-soft hover:shadow-soft-md hover:-translate-y-0.5"
              >
                Start Tracking — Free
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-warm-500 hover:text-warm-700 font-medium px-4 py-3 transition-colors"
              >
                Sign In
                <ChevronRight className="w-4 h-4" />
              </Link>
            </motion.div>

            {/* Trust indicators */}
            <motion.div
              variants={fadeIn}
              className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-8 text-warm-300 text-sm"
            >
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-income" />
                Free forever
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-income" />
                No credit card
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-income" />
                Works on any device
              </span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Dashboard Preview */}
      <section className="relative px-6 pb-20 sm:pb-28">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={scaleIn}
          className="max-w-4xl mx-auto relative"
        >
          {/* Floating category pills — desktop only */}
          <motion.div
            className="absolute -top-3 -right-2 sm:-right-12 bg-white rounded-full px-3 py-1.5 shadow-soft border border-cream-200 hidden sm:flex items-center gap-1.5 z-10"
            animate={{ y: [0, -8, 0] }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-expense" />
            <span className="text-xs font-medium text-warm-500">
              Groceries
            </span>
          </motion.div>
          <motion.div
            className="absolute top-1/3 -left-4 sm:-left-16 bg-white rounded-full px-3 py-1.5 shadow-soft border border-cream-200 hidden sm:flex items-center gap-1.5 z-10"
            animate={{ y: [0, -6, 0] }}
            transition={{
              duration: 3.5,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 1,
            }}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-income" />
            <span className="text-xs font-medium text-warm-500">Salary</span>
          </motion.div>
          <motion.div
            className="absolute bottom-16 -right-2 sm:-right-10 bg-white rounded-full px-3 py-1.5 shadow-soft border border-cream-200 hidden sm:flex items-center gap-1.5 z-10"
            animate={{ y: [0, -5, 0] }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 0.5,
            }}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-amber" />
            <span className="text-xs font-medium text-warm-500">Coffee</span>
          </motion.div>

          {/* Perspective wrapper — only on desktop */}
          <div className="sm:[perspective:1200px]">
            <div className="sm:[transform:rotateX(2deg)] transition-transform duration-500">
              <DashboardMockup />
            </div>
          </div>

          {/* Soft glow beneath mockup */}
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-3/4 h-16 bg-amber/[0.08] rounded-full blur-2xl" />
        </motion.div>
      </section>

      {/* Receipt Scanning Showcase */}
      <section className="relative px-6 py-20 sm:py-28">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={stagger}
            className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center"
          >
            {/* Left: copy */}
            <motion.div variants={fadeInLeft}>
              <p className="text-xs font-medium tracking-[0.2em] uppercase text-amber-dark mb-3">
                AI-Powered
              </p>
              <h2 className="font-serif text-3xl sm:text-4xl text-warm-700 mb-4">
                Snap a Receipt,{" "}
                <span className="text-amber">Skip the Typing</span>
              </h2>
              <p className="text-warm-400 text-lg leading-relaxed mb-8">
                Point your camera at any receipt and let AI do the data entry.
                Amount, date, category, and merchant — extracted in seconds.
              </p>

              <div className="space-y-4">
                {[
                  {
                    emoji: "📸",
                    text: "Take a photo or upload from your gallery",
                  },
                  {
                    emoji: "✨",
                    text: "AI extracts amount, date, category & merchant",
                  },
                  {
                    emoji: "✓",
                    text: "Review, edit if needed, and save in one tap",
                  },
                ].map((item) => (
                  <div key={item.text} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-light flex items-center justify-center text-sm">
                      {item.emoji}
                    </span>
                    <p className="text-warm-500 text-sm leading-relaxed pt-1.5">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Right: phone mockup */}
            <motion.div
              variants={fadeInRight}
              className="flex justify-center lg:justify-end"
            >
              <ReceiptPhoneMockup />
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="relative px-6 py-20 sm:py-28">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={stagger}
            className="text-center mb-14"
          >
            <motion.p
              variants={fadeIn}
              className="text-xs font-medium tracking-[0.2em] uppercase text-amber-dark mb-3"
            >
              Features
            </motion.p>
            <motion.h2
              variants={fadeIn}
              className="font-serif text-3xl sm:text-4xl text-warm-700"
            >
              Everything you need, nothing you don&apos;t
            </motion.h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
            variants={stagger}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
          >
            {features.map((f) => (
              <motion.div
                key={f.title}
                variants={fadeIn}
                className="card p-5 grain-overlay group hover:shadow-soft-md hover:-translate-y-0.5 transition-all duration-300"
              >
                <div
                  className={`w-10 h-10 rounded-xl ${f.bg} flex items-center justify-center mb-3`}
                >
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className="font-serif text-base text-warm-700 mb-1.5">
                  {f.title}
                </h3>
                <p className="text-sm text-warm-400 leading-relaxed">
                  {f.description}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative px-6 py-20 sm:py-28 bg-white/40">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={stagger}
            className="text-center mb-14"
          >
            <motion.p
              variants={fadeIn}
              className="text-xs font-medium tracking-[0.2em] uppercase text-amber-dark mb-3"
            >
              How It Works
            </motion.p>
            <motion.h2
              variants={fadeIn}
              className="font-serif text-3xl sm:text-4xl text-warm-700"
            >
              Three steps to clarity
            </motion.h2>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
            variants={stagger}
            className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6"
          >
            {steps.map((step, i) => (
              <motion.div
                key={step.number}
                variants={fadeIn}
                className="text-center sm:text-left"
              >
                <span className="font-serif text-5xl text-amber/20 block mb-2">
                  {step.number}
                </span>
                <h3 className="font-serif text-lg text-warm-700 mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-warm-400 leading-relaxed">
                  {step.description}
                </p>
                {i < steps.length - 1 && (
                  <div className="hidden sm:block mt-4">
                    <ArrowRight className="w-5 h-5 text-cream-400 mx-auto sm:mx-0" />
                  </div>
                )}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative px-6 py-20 sm:py-28">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
          variants={stagger}
          className="max-w-2xl mx-auto text-center"
        >
          <motion.h2
            variants={fadeIn}
            className="font-serif text-3xl sm:text-4xl text-warm-700 mb-4"
          >
            Ready to take control?
          </motion.h2>
          <motion.p
            variants={fadeIn}
            className="text-warm-400 text-lg mb-8 leading-relaxed"
          >
            Start tracking your budget today. It&apos;s free, it&apos;s
            beautiful, and it only takes 30 seconds to get started.
          </motion.p>
          <motion.div variants={fadeIn}>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 bg-amber hover:bg-amber-dark text-white font-medium px-8 py-3.5 rounded-xl transition-all shadow-soft hover:shadow-soft-md hover:-translate-y-0.5 text-lg"
            >
              Create Free Account
              <ArrowRight className="w-5 h-5" />
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-cream-300/40 px-6 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-warm-300 text-sm">
            <Wallet className="w-4 h-4" />
            <span>&copy; {new Date().getFullYear()} Budget Tracker</span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <Link
              href="/login"
              className="text-warm-400 hover:text-warm-600 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="text-warm-400 hover:text-warm-600 transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard Mockup — floating perspective preview                    */
/* ------------------------------------------------------------------ */

function DashboardMockup() {
  return (
    <div className="card overflow-hidden shadow-soft-lg">
      <div className="p-5 sm:p-6 bg-cream-50/80">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="font-serif text-lg text-warm-700">Dashboard</p>
            <p className="text-xs text-warm-300">February 2026</p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-amber-light flex items-center justify-center">
            <EyeOff className="w-4 h-4 text-amber" />
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white rounded-xl p-3.5 border border-cream-200/60 shadow-warm">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-[#3b82f6]/10 flex items-center justify-center">
                <Wallet className="w-3.5 h-3.5 text-[#3b82f6]" />
              </div>
              <span className="text-[11px] text-warm-400">Balance</span>
            </div>
            <p className="font-display text-base sm:text-lg font-semibold text-income">
              ₱193,412
            </p>
          </div>

          <div className="bg-white rounded-xl p-3.5 border border-cream-200/60 shadow-warm">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-expense-light flex items-center justify-center">
                <TrendingDown className="w-3.5 h-3.5 text-expense" />
              </div>
              <span className="text-[11px] text-warm-400">Expenses</span>
            </div>
            <p className="font-display text-base sm:text-lg font-semibold text-expense">
              ₱28,340
            </p>
          </div>

          <div className="bg-white rounded-xl p-3.5 border border-cream-200/60 shadow-warm">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-income-light flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-income" />
              </div>
              <span className="text-[11px] text-warm-400">Income</span>
            </div>
            <p className="font-display text-base sm:text-lg font-semibold text-income">
              ₱45,000
            </p>
          </div>
        </div>

        {/* Mock bar chart */}
        <div className="bg-white rounded-xl p-4 border border-cream-200/60 shadow-warm mb-5">
          <p className="font-serif text-sm text-warm-600 mb-3">
            Monthly Trend
          </p>
          <div className="flex items-end gap-2 h-24">
            {[
              { income: 55, expense: 40 },
              { income: 60, expense: 50 },
              { income: 45, expense: 35 },
              { income: 70, expense: 55 },
              { income: 65, expense: 45 },
              { income: 75, expense: 50 },
            ].map((bar, i) => (
              <div key={i} className="flex-1 flex items-end gap-0.5">
                <div
                  className="flex-1 rounded-t bg-income/70"
                  style={{ height: `${bar.income}%` }}
                />
                <div
                  className="flex-1 rounded-t bg-expense/70"
                  style={{ height: `${bar.expense}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2">
            {["Sep", "Oct", "Nov", "Dec", "Jan", "Feb"].map((m) => (
              <span
                key={m}
                className="text-[10px] text-warm-300 flex-1 text-center"
              >
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* Mock transactions */}
        <div className="bg-white rounded-xl border border-cream-200/60 shadow-warm overflow-hidden">
          <p className="font-serif text-sm text-warm-600 p-4 pb-2">
            Recent Transactions
          </p>
          {[
            {
              name: "Grocery Store",
              category: "Food",
              amount: "−₱2,450",
              color: "#C44B3F",
              dot: "bg-expense",
            },
            {
              name: "Salary Deposit",
              category: "Salary",
              amount: "+₱45,000",
              color: "#2D8B5A",
              dot: "bg-income",
            },
            {
              name: "Electric Bill",
              category: "Utilities",
              amount: "−₱3,200",
              color: "#C44B3F",
              dot: "bg-amber",
            },
          ].map((tx) => (
            <div
              key={tx.name}
              className="flex items-center gap-3 px-4 py-3 border-t border-cream-100"
            >
              <div
                className={`w-8 h-8 rounded-lg ${tx.dot}/10 flex items-center justify-center`}
              >
                <div className={`w-2.5 h-2.5 rounded-full ${tx.dot}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-warm-600 truncate">
                  {tx.name}
                </p>
                <p className="text-[10px] text-warm-300">{tx.category}</p>
              </div>
              <span
                className="text-xs font-display font-semibold tabular-nums"
                style={{ color: tx.color }}
              >
                {tx.amount}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Receipt Phone Mockup — scan result preview                         */
/* ------------------------------------------------------------------ */

function ReceiptPhoneMockup() {
  return (
    <div className="relative">
      {/* Glow behind phone */}
      <div className="absolute inset-0 bg-amber/10 rounded-[3rem] blur-2xl scale-90" />

      {/* Phone frame */}
      <div className="relative bg-warm-800 rounded-[2.5rem] p-3 shadow-soft-lg w-[280px]">
        {/* Dynamic island */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-20 h-5 bg-warm-900 rounded-full z-10" />

        {/* Screen */}
        <div className="relative bg-cream-50 rounded-[2rem] overflow-hidden">
          <div className="pt-12 pb-6 px-4 min-h-[480px] flex flex-col">
            {/* Success header */}
            <div className="text-center mb-5">
              <div className="w-11 h-11 bg-income-light rounded-2xl flex items-center justify-center mx-auto mb-2">
                <Check className="w-5 h-5 text-income" />
              </div>
              <p className="font-serif text-warm-700 text-sm">
                Receipt Scanned
              </p>
              <p className="text-[10px] text-warm-300 mt-0.5">
                All fields extracted by AI
              </p>
            </div>

            {/* Extracted fields */}
            <div className="space-y-2.5 flex-1">
              <div className="bg-white rounded-xl p-3 border border-cream-200/60">
                <span className="text-[9px] text-warm-300 uppercase tracking-wider font-medium">
                  Amount
                </span>
                <p className="font-display text-xl font-semibold text-expense mt-0.5">
                  ₱2,450.00
                </p>
              </div>
              <div className="bg-white rounded-xl p-3 border border-cream-200/60">
                <span className="text-[9px] text-warm-300 uppercase tracking-wider font-medium">
                  Category
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-5 h-5 rounded bg-expense/10 flex items-center justify-center">
                    <Tags className="w-3 h-3 text-expense" />
                  </div>
                  <span className="text-sm text-warm-600">Groceries</span>
                </div>
              </div>
              <div className="bg-white rounded-xl p-3 border border-cream-200/60">
                <span className="text-[9px] text-warm-300 uppercase tracking-wider font-medium">
                  Date
                </span>
                <p className="text-sm text-warm-600 mt-0.5">Feb 22, 2026</p>
              </div>
              <div className="bg-white rounded-xl p-3 border border-cream-200/60">
                <span className="text-[9px] text-warm-300 uppercase tracking-wider font-medium">
                  Merchant
                </span>
                <p className="text-sm text-warm-600 mt-0.5">SM Supermarket</p>
              </div>
            </div>

            {/* Save button */}
            <div className="mt-4">
              <div className="w-full bg-amber text-white text-sm font-medium py-2.5 rounded-xl text-center shadow-soft">
                Save Transaction
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
