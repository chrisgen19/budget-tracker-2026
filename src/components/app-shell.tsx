"use client";

import { useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  BarChart3,
  ArrowLeftRight,
  CalendarClock,
  Tags,
  Tag,
  Wallet,
  ScanLine,
  Shield,
  AlertTriangle,
} from "lucide-react";
import { cn, formatDateInput } from "@/lib/utils";
import { motion } from "framer-motion";
import { useUser } from "@/components/user-provider";
import { ProfileMenu } from "@/components/profile-menu";
import { ScanProvider } from "@/components/scan-provider";
import { ScanReceiptSheet } from "@/components/scan-receipt-sheet";
import { Modal } from "@/components/ui/modal";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { MultiScanReview } from "@/components/multi-scan-review";
import { useCreateTransaction } from "@/hooks/use-transactions";
import { useMultiScan } from "@/hooks/use-multi-scan";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { BillReminderBanner, type PayAndEditData } from "@/components/bills/bill-reminder-banner";
import { InstallBannerProvider } from "@/components/pwa/install-banner-context";
import { InstallPromptBanner } from "@/components/pwa/install-prompt-banner";
import { OfflineBanner } from "@/components/pwa/offline-banner";
import { useBillAction } from "@/hooks/use-bills";
import { useToast } from "@/components/ui/toast";
import type { MultiScanItem } from "@/types";
import type { TransactionInput } from "@/lib/validations";

interface AppShellProps {
  children: React.ReactNode;
}

/** Take a date string from Gemini (YYYY-MM-DD or YYYY-MM-DDTHH:mm) and
 *  replace the time portion with the user's current local time. */
const withLocalTime = (dateStr: string): string => {
  // Strip any time portion Gemini may have included
  const dateOnly = dateStr.slice(0, 10);
  return formatDateInput(new Date(dateOnly + "T" + new Date().toTimeString().slice(0, 5)));
};

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/bills", label: "Bills", icon: CalendarClock },
  { href: "/categories", label: "Categories", icon: Tags },
  { href: "/labels", label: "Labels", icon: Tag },
];

/** Hidden from the mobile bottom nav — reachable via the profile menu instead.
 *  Labels avoids overflow; Bills/Categories live in the profile menu. */
const MOBILE_NAV_EXCLUDED = ["/labels", "/bills", "/categories"];
const MOBILE_NAV_ITEMS = NAV_ITEMS.filter(
  (item) => !MOBILE_NAV_EXCLUDED.includes(item.href)
);

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const { user } = useUser();
  const { showToast } = useToast();
  const createTransactionMutation = useCreateTransaction();
  const billActionMutation = useBillAction();
  const [scanOpen, setScanOpen] = useState(false);

  // Bill reminder "Pay & Edit" state
  const [billEditData, setBillEditData] = useState<PayAndEditData | null>(null);

  const scan = useMultiScan();
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Scan limit calculations
  const hasLimit = user.monthlyScanLimit > 0;
  const scansRemaining = hasLimit
    ? Math.max(0, user.monthlyScanLimit - user.scansUsedThisMonth)
    : null; // null = unlimited
  const scanLimitReached = hasLimit && scansRemaining === 0;
  const scansRunningLow = hasLimit && !scanLimitReached && scansRemaining !== null && scansRemaining <= 10;
  const showScanNotice = user.receiptScanEnabled && user.roleScanEnabled && (scanLimitReached || scansRunningLow);

  const handleReceiptFileSelected = async (file: File) => {
    // On failure the sheet stays open so the error sits beside the buttons that retry it.
    if (!(await scan.scanSingle(file))) return;
    // Batched into one render so the sheet never overlaps the review modal.
    setScanOpen(false);
    scan.openReview();
  };

  const handleMultipleFilesSelected = useCallback(
    async (files: File[]) => {
      setScanOpen(false);
      await scan.scanMultiple(files);
    },
    [scan],
  );

  const handleScanSheetClose = () => {
    // Prevent closing while scanning
    if (scan.isScanning) return;
    setScanOpen(false);
    scan.setScanError(null);
  };

  const handleMultiScanEditSubmit = async (input: TransactionInput) => {
    if (!editingItemId) return;
    scan.updateItem(editingItemId, {
      amount: input.amount,
      description: input.description,
      type: input.type,
      date: input.date,
      categoryId: input.categoryId,
      labelIds: input.labelIds,
    });
    setEditingItemId(null);
  };

  /** Closing discards every reviewed row, so confirm when there is anything to lose —
   *  scanned rows waiting to be saved, or failed rows still holding a retryable image. */
  const handleMultiScanClose = () => {
    if (scan.isBusy || scan.isSavingAll) return;
    if (scan.unsavedCount > 0 || scan.retryableCount > 0) {
      setConfirmDiscard(true);
      return;
    }
    scan.reset();
    setEditingItemId(null);
  };

  const handleConfirmDiscard = () => {
    setConfirmDiscard(false);
    scan.reset();
    setEditingItemId(null);
  };

  const handleBillPayAndEditSubmit = async (input: TransactionInput) => {
    const newTx = await createTransactionMutation.mutateAsync(input);

    // Log the bill as paid with the newly created transaction ID
    if (billEditData) {
      try {
        await billActionMutation.mutateAsync({
          id: billEditData.billId,
          input: {
            action: "pay_existing",
            dueDate: billEditData.billDueDate,
            transactionId: newTx.id,
          },
        });
        showToast(`${billEditData.description || "Bill"} paid`);
      } catch {
        showToast("Transaction saved but bill could not be marked as paid. Please pay the bill manually.");
      }
    }

    setBillEditData(null);
  };

  return (
    <InstallBannerProvider>
    <div className="min-h-screen bg-cream-100">
      {/* Offline Banner */}
      <OfflineBanner />

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
          <ProfileMenu
            variant="desktop"
            name={user.name}
            email={user.email}
            isAdmin={user.role === "ADMIN"}
          />
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 inset-x-0 bg-white/90 backdrop-blur-md border-b border-cream-300/60 z-30 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber text-white flex items-center justify-center shadow-soft">
            <Wallet className="w-4 h-4" />
          </div>
          <h1 className="font-serif text-lg text-warm-700">Budget Tracker</h1>
        </div>
      </header>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white/90 backdrop-blur-md border-t border-cream-300/60 z-30 px-2 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-start justify-around py-2">
          {MOBILE_NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 px-1 py-2 rounded-xl transition-all duration-200 flex-1 basis-0 min-w-0",
                  isActive
                    ? "text-amber"
                    : "text-warm-300"
                )}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                <span className="text-[10px] font-medium truncate w-full text-center">
                  {item.label}
                </span>
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
                "flex flex-col items-center gap-1 px-1 py-2 rounded-xl transition-all duration-200 flex-1 basis-0 min-w-0 relative",
                scanLimitReached ? "text-warm-200 cursor-not-allowed" : "text-warm-300"
              )}
            >
              <ScanLine className="w-5 h-5 shrink-0" />
              <span className="text-[10px] font-medium truncate w-full text-center">Scan</span>
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
          <ProfileMenu
            variant="mobile"
            triggerStyle="tab"
            name={user.name}
            email={user.email}
            isAdmin={user.role === "ADMIN"}
          />
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

      {/* Bill Reminder Banner */}
      <BillReminderBanner onPayAndEdit={setBillEditData} />

      {/* PWA Install Prompt */}
      <InstallPromptBanner />

      {/* Bill Pay & Edit Modal */}
      <Modal
        open={billEditData !== null}
        onClose={() => setBillEditData(null)}
        title="Pay & Edit"
      >
        {billEditData && (
          <TransactionForm
            initialData={billEditData}
            hideLabelPicker
            onSubmit={handleBillPayAndEditSubmit}
            onCancel={() => setBillEditData(null)}
          />
        )}
      </Modal>

      {/* Scan Receipt Sheet */}
      <ScanReceiptSheet
        open={scanOpen}
        onClose={handleScanSheetClose}
        onFileSelected={handleReceiptFileSelected}
        onMultipleFilesSelected={handleMultipleFilesSelected}
        isScanning={scan.isScanning}
        error={scan.scanError}
        maxUploadFiles={user.maxUploadFiles}
        scansRemaining={scansRemaining}
      />

      {/* Multi-Scan Review Modal */}
      <Modal
        open={scan.showReview && editingItemId === null}
        onClose={handleMultiScanClose}
        title="Review Scanned Receipts"
      >
        {scan.showReview && editingItemId === null && (
          <MultiScanReview
            items={scan.items}
            onEdit={setEditingItemId}
            onRemove={scan.removeItem}
            onItemize={scan.itemizeItem}
            onRetry={scan.retryItem}
            onSaveAll={scan.saveAll}
            onClose={handleMultiScanClose}
            isSaving={scan.isSavingAll}
          />
        )}
      </Modal>

      {/* Discard confirmation — closing the review drops every row. Scanned rows cost
          allowance to reproduce; failed rows were refunded but still hold the photo. */}
      <ConfirmModal
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={handleConfirmDiscard}
        title="Discard scanned receipts?"
        message={
          <>
            {scan.unsavedCount > 0 && (
              <p>
                {scan.unsavedCount} scanned receipt{scan.unsavedCount === 1 ? "" : "s"}{" "}
                {scan.unsavedCount === 1 ? "has" : "have"} not been saved. Re-scanning{" "}
                {scan.unsavedCount === 1 ? "it" : "them"} will use your scan allowance again.
              </p>
            )}
            {scan.retryableCount > 0 && (
              <p className={scan.unsavedCount > 0 ? "mt-2" : undefined}>
                {scan.retryableCount} receipt{scan.retryableCount === 1 ? "" : "s"} failed to
                scan and can still be retried. Closing means picking{" "}
                {scan.retryableCount === 1 ? "that photo" : "those photos"} again.
              </p>
            )}
          </>
        }
        confirmLabel="Discard"
      />

      {/* Multi-Scan Edit Modal */}
      <Modal
        open={editingItemId !== null}
        onClose={() => setEditingItemId(null)}
        title="Edit Transaction"
      >
        {editingItemId !== null &&
          (() => {
            const editItem = scan.items.find((i) => i.id === editingItemId);
            if (!editItem?.data) return null;
            return (
              <TransactionForm
                initialData={{
                  amount: editItem.data.amount,
                  description: editItem.data.description,
                  type: editItem.data.type,
                  date: editItem.data.date,
                  categoryId: editItem.data.categoryId,
                  labelIds: editItem.data.labelIds,
                }}
                dateWarning={editItem.data.dateWarning}
                onSubmit={handleMultiScanEditSubmit}
                onCancel={() => setEditingItemId(null)}
              />
            );
          })()}
      </Modal>
    </div>
    </InstallBannerProvider>
  );
}
