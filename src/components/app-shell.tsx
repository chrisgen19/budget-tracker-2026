"use client";

import { useState, useCallback } from "react";
import { usePathname } from "next/navigation";
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
  Shield,
  AlertTriangle,
} from "lucide-react";
import { cn, compressImage } from "@/lib/utils";
import { motion } from "framer-motion";
import { useUser } from "@/components/user-provider";
import { ScanProvider } from "@/components/scan-provider";
import { ScanReceiptSheet } from "@/components/scan-receipt-sheet";
import { Modal } from "@/components/ui/modal";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { MultiScanReview } from "@/components/multi-scan-review";
import { useBatchCreateTransactions } from "@/hooks/use-transactions";
import type { MultiScanItem } from "@/types";
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
  const { user, setUser } = useUser();
  const batchCreateMutation = useBatchCreateTransactions();
  const [scanOpen, setScanOpen] = useState(false);

  // Single-scan OCR state
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Multi-scan state
  const [multiScanItems, setMultiScanItems] = useState<MultiScanItem[]>([]);
  const [showMultiScanReview, setShowMultiScanReview] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [isSavingAll, setIsSavingAll] = useState(false);

  // Scan limit calculations
  const hasLimit = user.monthlyScanLimit > 0;
  const scansRemaining = hasLimit
    ? Math.max(0, user.monthlyScanLimit - user.scansUsedThisMonth)
    : null; // null = unlimited
  const scanLimitReached = hasLimit && scansRemaining === 0;
  const scansRunningLow = hasLimit && !scanLimitReached && scansRemaining !== null && scansRemaining <= 10;
  const showScanNotice = user.receiptScanEnabled && user.roleScanEnabled && (scanLimitReached || scansRunningLow);

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

      // Success — push into review modal (same flow as multi-scan)
      const itemId = `${Date.now()}-single`;
      setMultiScanItems([
        {
          id: itemId,
          fileName: file.name,
          status: "success" as const,
          data: {
            amount: data.amount,
            description: data.description,
            type: data.type,
            date: data.date,
            categoryId: data.categoryId,
          },
          imageFile: compressed,
        },
      ]);
      setIsScanning(false);
      setScanOpen(false);
      setShowMultiScanReview(true);

      // Increment local scan count
      setUser((prev) => ({ scansUsedThisMonth: prev.scansUsedThisMonth + 1 }));
    } catch {
      setScanError("Network error. Please check your connection and try again.");
      setIsScanning(false);
    }
  };

  const handleScanSheetClose = () => {
    // Prevent closing while scanning
    if (isScanning) return;
    setScanOpen(false);
    setScanError(null);
  };

  // -- Multi-scan handlers --

  const handleMultipleFilesSelected = useCallback(
    async (files: File[]) => {
      // Close the scan sheet, init items, open review modal
      setScanOpen(false);
      setScanError(null);

      const initialItems: MultiScanItem[] = files.map((f, i) => ({
        id: `${Date.now()}-${i}`,
        fileName: f.name,
        status: "scanning" as const,
      }));

      setMultiScanItems(initialItems);
      setShowMultiScanReview(true);

      // Compress all files in parallel (client-side only, no API cost)
      const compressed = await Promise.all(
        files.map((f) => compressImage(f).catch(() => f))
      );

      // Process API calls with max 2 concurrent requests
      const CONCURRENCY = 3;
      let nextIndex = 0;

      const processNext = async (): Promise<void> => {
        while (nextIndex < compressed.length) {
          const i = nextIndex++;
          const file = compressed[i];
          const itemId = initialItems[i].id;

          try {
            const formData = new FormData();
            formData.append("receipt", file);

            const res = await fetch("/api/receipts/scan", {
              method: "POST",
              body: formData,
            });

            const data = await res.json();

            if (!res.ok) {
              setMultiScanItems((prev) =>
                prev.map((item) =>
                  item.id === itemId
                    ? { ...item, status: "error" as const, error: data.error ?? "Failed to scan receipt." }
                    : item
                )
              );
              continue;
            }

            setMultiScanItems((prev) =>
              prev.map((item) =>
                item.id === itemId
                  ? {
                      ...item,
                      status: "success" as const,
                      data: {
                        amount: data.amount,
                        description: data.description,
                        type: data.type,
                        date: data.date,
                        categoryId: data.categoryId,
                      },
                      imageFile: file instanceof File ? file : undefined,
                    }
                  : item
              )
            );

            // Increment local scan count
            setUser((prev) => ({ scansUsedThisMonth: prev.scansUsedThisMonth + 1 }));
          } catch {
            setMultiScanItems((prev) =>
              prev.map((item) =>
                item.id === itemId
                  ? { ...item, status: "error" as const, error: "Network error. Please try again." }
                  : item
              )
            );
          }
        }
      };

      // Start concurrent workers
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, compressed.length) }, () =>
          processNext()
        )
      );
    },
    [setUser]
  );

  const handleMultiScanEdit = (id: string) => {
    setEditingItemId(id);
  };

  const handleMultiScanEditSubmit = async (input: TransactionInput) => {
    if (!editingItemId) return;

    // Update item data in state — no API call yet
    setMultiScanItems((prev) =>
      prev.map((item) =>
        item.id === editingItemId
          ? {
              ...item,
              data: {
                amount: input.amount,
                description: input.description,
                type: input.type,
                date: input.date,
                categoryId: input.categoryId,
              },
            }
          : item
      )
    );
    setEditingItemId(null);
  };

  const handleMultiScanRemove = (id: string) => {
    setMultiScanItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleItemize = async (id: string) => {
    const item = multiScanItems.find((i) => i.id === id);
    if (!item?.imageFile) return;

    // Set status to breaking_down
    setMultiScanItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: "breaking_down" as const } : i))
    );

    try {
      const formData = new FormData();
      formData.append("receipt", item.imageFile);

      const res = await fetch("/api/receipts/breakdown", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        // Revert to success on error
        setMultiScanItems((prev) =>
          prev.map((i) => (i.id === id ? { ...i, status: "success" as const } : i))
        );
        return;
      }

      // Build per-transaction breakdown metadata with individual line items
      const receiptGroupId = crypto.randomUUID();

      interface BreakdownItem {
        amount: number;
        categoryId: string;
        description: string;
        lineItems: Array<{ name: string; amount: number }>;
      }

      // Replace the single item with N breakdown items (one per category group)
      const breakdownItems: MultiScanItem[] = data.items.map(
        (bi: BreakdownItem, idx: number) => ({
          id: `${id}-breakdown-${idx}`,
          fileName: item.fileName,
          status: "success" as const,
          data: {
            amount: bi.amount,
            description: bi.description,
            type: "EXPENSE" as const,
            date: data.date,
            categoryId: bi.categoryId,
            receiptGroupId,
            // Per-transaction breakdown: line items within this category
            receiptBreakdown: {
              total: bi.amount,
              items: bi.lineItems.map((li) => ({
                name: li.name,
                amount: li.amount,
              })),
            },
          },
          parentId: id,
        })
      );

      setMultiScanItems((prev) => {
        const index = prev.findIndex((i) => i.id === id);
        if (index === -1) return prev;
        const next = [...prev];
        next.splice(index, 1, ...breakdownItems);
        return next;
      });

      // Increment local scan count (breakdown = 1 additional credit)
      setUser((prev) => ({ scansUsedThisMonth: prev.scansUsedThisMonth + 1 }));
    } catch {
      // Revert to success on network error
      setMultiScanItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status: "success" as const } : i))
      );
    }
  };

  const handleMultiScanSaveAll = async () => {
    setIsSavingAll(true);

    const successItems = multiScanItems.filter((i) => i.status === "success" && i.data);

    try {
      await batchCreateMutation.mutateAsync(
        successItems.map((item) => ({
          amount: item.data!.amount!,
          description: item.data!.description!,
          type: item.data!.type!,
          date: item.data!.date ? new Date(item.data!.date).toISOString() : new Date().toISOString(),
          categoryId: item.data!.categoryId!,
          ...(item.data!.receiptGroupId && { receiptGroupId: item.data!.receiptGroupId }),
          ...(item.data!.receiptBreakdown && { receiptBreakdown: item.data!.receiptBreakdown }),
        }))
      );
    } catch {
      const failedIds = new Set(successItems.map((i) => i.id));
      setMultiScanItems((prev) =>
        prev.map((i) =>
          failedIds.has(i.id)
            ? { ...i, status: "error" as const, error: "Failed to save." }
            : i
        )
      );
      setIsSavingAll(false);
      return;
    }

    setIsSavingAll(false);
    setShowMultiScanReview(false);
    setMultiScanItems([]);
    setEditingItemId(null);
  };

  const handleMultiScanClose = () => {
    // Block closing while scanning, breaking down, or saving
    const isStillScanning = multiScanItems.some(
      (i) => i.status === "scanning" || i.status === "breaking_down"
    );
    if (isStillScanning || isSavingAll) return;

    setShowMultiScanReview(false);
    setMultiScanItems([]);
    setEditingItemId(null);
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
          {user.role === "ADMIN" && (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 relative",
                pathname.startsWith("/admin")
                  ? "bg-amber-light text-amber-dark"
                  : "text-warm-400 hover:text-warm-600 hover:bg-cream-100"
              )}
            >
              {pathname.startsWith("/admin") && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-amber-light rounded-xl"
                  transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
                />
              )}
              <Shield className="w-5 h-5 relative z-10" />
              <span className="relative z-10">Admin</span>
            </Link>
          )}
        </nav>

        {/* User section */}
        <div className="border-t border-cream-200 p-4">
          {showScanNotice && (
            <div className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 mb-3 rounded-xl text-xs",
              scanLimitReached
                ? "bg-expense-light/50 border border-expense/20 text-expense"
                : "bg-amber-light/50 border border-amber/20 text-amber-dark"
            )}>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="font-medium">
                {scanLimitReached
                  ? "Monthly scan limit reached"
                  : `${scansRemaining} scan${scansRemaining === 1 ? "" : "s"} remaining this month`}
              </span>
            </div>
          )}
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
          {user.receiptScanEnabled && user.roleScanEnabled && (
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              disabled={scanLimitReached}
              className={cn(
                "flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all duration-200 min-w-[72px] relative",
                scanLimitReached ? "text-warm-200 cursor-not-allowed" : "text-warm-300"
              )}
            >
              <ScanLine className="w-5 h-5" />
              <span className="text-[10px] font-medium">Scan</span>
              {hasLimit && (
                <span className={cn(
                  "text-[9px] font-medium",
                  scanLimitReached ? "text-expense" : "text-warm-400"
                )}>
                  {user.scansUsedThisMonth}/{user.monthlyScanLimit}
                </span>
              )}
            </button>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="lg:pl-64 pt-16 lg:pt-0 pb-24 lg:pb-0 min-h-screen">
        <div className="max-w-6xl mx-auto p-4 lg:p-8">
          <ScanProvider
            value={{
              openScan: () => setScanOpen(true),
              canScan: user.receiptScanEnabled && user.roleScanEnabled,
              scanLimitReached: !!scanLimitReached,
              scansRemaining,
              hasLimit,
            }}
          >
            {children}
          </ScanProvider>
        </div>
      </main>

      {/* Scan Receipt Sheet */}
      <ScanReceiptSheet
        open={scanOpen}
        onClose={handleScanSheetClose}
        onFileSelected={handleReceiptFileSelected}
        onMultipleFilesSelected={handleMultipleFilesSelected}
        isScanning={isScanning}
        error={scanError}
        maxUploadFiles={user.maxUploadFiles}
        scansRemaining={scansRemaining}
      />

      {/* Multi-Scan Review Modal */}
      <Modal
        open={showMultiScanReview && editingItemId === null}
        onClose={handleMultiScanClose}
        title="Review Scanned Receipts"
      >
        {showMultiScanReview && editingItemId === null && (
          <MultiScanReview
            items={multiScanItems}
            onEdit={handleMultiScanEdit}
            onRemove={handleMultiScanRemove}
            onItemize={handleItemize}
            onSaveAll={handleMultiScanSaveAll}
            onClose={handleMultiScanClose}
            isSaving={isSavingAll}
          />
        )}
      </Modal>

      {/* Multi-Scan Edit Modal */}
      <Modal
        open={editingItemId !== null}
        onClose={() => setEditingItemId(null)}
        title="Edit Transaction"
      >
        {editingItemId !== null &&
          (() => {
            const editItem = multiScanItems.find((i) => i.id === editingItemId);
            if (!editItem?.data) return null;
            return (
              <TransactionForm
                initialData={{
                  amount: editItem.data.amount,
                  description: editItem.data.description,
                  type: editItem.data.type,
                  date: editItem.data.date,
                  categoryId: editItem.data.categoryId,
                }}
                onSubmit={handleMultiScanEditSubmit}
                onCancel={() => setEditingItemId(null)}
              />
            );
          })()}
      </Modal>
    </div>
  );
}
