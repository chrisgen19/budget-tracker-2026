"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Tags,
  LogOut,
  Wallet,
  User,
  ScanLine,
} from "lucide-react";
import { cn, compressImage } from "@/lib/utils";
import { motion } from "framer-motion";
import { useUser } from "@/components/user-provider";
import { ScanReceiptSheet } from "@/components/scan-receipt-sheet";
import { Modal } from "@/components/ui/modal";
import {
  TransactionForm,
  type InitialTransactionData,
} from "@/components/transactions/transaction-form";
import type { TransactionInput } from "@/lib/validations";

interface AppShellProps {
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/categories", label: "Categories", icon: Tags },
];

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useUser();
  const [scanOpen, setScanOpen] = useState(false);

  // OCR scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanData, setScanData] = useState<InitialTransactionData | null>(null);
  const [showScanForm, setShowScanForm] = useState(false);

  const handleReceiptFileSelected = async (file: File) => {
    setIsScanning(true);
    setScanError(null);

    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append("receipt", compressed);

      const res = await fetch("/api/receipts/scan", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setScanError(data.error ?? "Failed to scan receipt.");
        setIsScanning(false);
        return;
      }

      // Success — close scan sheet, open transaction form
      setScanData({
        amount: data.amount,
        description: data.description,
        type: data.type,
        date: data.date,
        categoryId: data.categoryId,
      });
      setIsScanning(false);
      setScanOpen(false);
      setShowScanForm(true);
    } catch {
      setScanError("Network error. Please check your connection and try again.");
      setIsScanning(false);
    }
  };

  const handleScanFormSubmit = async (input: TransactionInput) => {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      throw new Error("Failed to save transaction");
    }

    setShowScanForm(false);
    setScanData(null);
    router.refresh();
  };

  const handleScanFormCancel = () => {
    setShowScanForm(false);
    setScanData(null);
  };

  const handleScanSheetClose = () => {
    // Prevent closing while scanning
    if (isScanning) return;
    setScanOpen(false);
    setScanError(null);
  };

  return (
    <div className="min-h-screen bg-cream-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col bg-white border-r border-cream-300/60 shadow-warm z-30">
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-6 border-b border-cream-200">
          <div className="w-10 h-10 rounded-xl bg-amber text-white flex items-center justify-center shadow-soft">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-serif text-lg text-warm-700 leading-tight">
              Budget
            </h1>
            <p className="text-[11px] text-warm-400 tracking-wider uppercase">
              Tracker
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 relative",
                  isActive
                    ? "bg-amber-light text-amber-dark"
                    : "text-warm-400 hover:text-warm-600 hover:bg-cream-100"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 bg-amber-light rounded-xl"
                    transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
                  />
                )}
                <item.icon className="w-5 h-5 relative z-10" />
                <span className="relative z-10">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-cream-200 p-4">
          <Link
            href="/profile"
            className="flex items-center gap-3 px-2 mb-3 rounded-xl py-1 -mx-0 hover:bg-cream-100 transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-cream-200 flex items-center justify-center">
              <User className="w-4 h-4 text-warm-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-warm-600 truncate">
                {user.name}
              </p>
              <p className="text-xs text-warm-400 truncate">{user.email}</p>
            </div>
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex items-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm text-warm-400 hover:text-expense hover:bg-expense-light transition-all duration-200"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 inset-x-0 bg-white/90 backdrop-blur-md border-b border-cream-300/60 z-30 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber text-white flex items-center justify-center shadow-soft">
              <Wallet className="w-4 h-4" />
            </div>
            <h1 className="font-serif text-lg text-warm-700">Budget Tracker</h1>
          </div>
          <Link
            href="/profile"
            className="p-2 rounded-xl text-warm-400 hover:text-warm-600 hover:bg-cream-100 transition-colors"
          >
            <User className="w-5 h-5" />
          </Link>
        </div>
      </header>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white/90 backdrop-blur-md border-t border-cream-300/60 z-30 px-2 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around py-2">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all duration-200 min-w-[72px]",
                  isActive
                    ? "text-amber"
                    : "text-warm-300"
                )}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
                {isActive && (
                  <motion.div
                    layoutId="mobile-active"
                    className="absolute -top-0.5 w-8 h-0.5 bg-amber rounded-full"
                    transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
                  />
                )}
              </Link>
            );
          })}
          {user.receiptScanEnabled && (
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              className="flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all duration-200 min-w-[72px] text-warm-300"
            >
              <ScanLine className="w-5 h-5" />
              <span className="text-[10px] font-medium">Scan</span>
            </button>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="lg:pl-64 pt-16 lg:pt-0 pb-24 lg:pb-0 min-h-screen">
        <div className="max-w-6xl mx-auto p-4 lg:p-8">
          {children}
        </div>
      </main>

      {/* Scan Receipt Sheet */}
      <ScanReceiptSheet
        open={scanOpen}
        onClose={handleScanSheetClose}
        onFileSelected={handleReceiptFileSelected}
        isScanning={isScanning}
        error={scanError}
      />

      {/* Scanned Transaction Form Modal */}
      <Modal
        open={showScanForm}
        onClose={handleScanFormCancel}
        title="Add Transaction"
      >
        {showScanForm && scanData && (
          <TransactionForm
            initialData={scanData}
            onSubmit={handleScanFormSubmit}
            onCancel={handleScanFormCancel}
          />
        )}
      </Modal>
    </div>
  );
}
