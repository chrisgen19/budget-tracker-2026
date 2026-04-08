"use client";

import { useState } from "react";
import { ScanLine, Mail, Rows3, Target, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/components/user-provider";

export function FeaturesForm() {
  const { user, setUser } = useUser();
  const [saving, setSaving] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [savingAutofocus, setSavingAutofocus] = useState(false);
  const [savingLabelType, setSavingLabelType] = useState(false);
  const [savingEmailReminders, setSavingEmailReminders] = useState(false);

  const handleToggle = async () => {
    const newValue = !user.receiptScanEnabled;

    setUser({ receiptScanEnabled: newValue });
    setSaving(true);

    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptScanEnabled: newValue }),
      });

      if (!res.ok) {
        setUser({ receiptScanEnabled: !newValue });
      }
    } catch {
      setUser({ receiptScanEnabled: !newValue });
    } finally {
      setSaving(false);
    }
  };

  const handleEmailRemindersToggle = async () => {
    const newValue = !user.emailBillReminders;

    setUser({ emailBillReminders: newValue });
    setSavingEmailReminders(true);

    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailBillReminders: newValue }),
      });

      if (!res.ok) {
        setUser({ emailBillReminders: !newValue });
      }
    } catch {
      setUser({ emailBillReminders: !newValue });
    } finally {
      setSavingEmailReminders(false);
    }
  };

  const handleLayoutToggle = async () => {
    const newValue = user.transactionLayout === "infinite" ? "pagination" : "infinite";
    const oldValue = user.transactionLayout;

    setUser({ transactionLayout: newValue });
    setSavingLayout(true);

    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionLayout: newValue }),
      });

      if (!res.ok) {
        setUser({ transactionLayout: oldValue });
      }
    } catch {
      setUser({ transactionLayout: oldValue });
    } finally {
      setSavingLayout(false);
    }
  };

  const handleAutofocusToggle = async () => {
    const newValue = !user.transactionAmountAutofocus;
    const oldValue = user.transactionAmountAutofocus;

    setUser({ transactionAmountAutofocus: newValue });
    setSavingAutofocus(true);

    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionAmountAutofocus: newValue }),
      });

      if (!res.ok) {
        setUser({ transactionAmountAutofocus: oldValue });
      }
    } catch {
      setUser({ transactionAmountAutofocus: oldValue });
    } finally {
      setSavingAutofocus(false);
    }
  };

  const handleLabelTypeChange = async (newValue: "EXPENSE" | "INCOME" | "BOTH") => {
    const oldValue = user.defaultLabelType;
    if (newValue === oldValue) return;

    setUser({ defaultLabelType: newValue });
    setSavingLabelType(true);

    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultLabelType: newValue }),
      });

      if (!res.ok) {
        setUser({ defaultLabelType: oldValue });
      }
    } catch {
      setUser({ defaultLabelType: oldValue });
    } finally {
      setSavingLabelType(false);
    }
  };

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="font-serif text-lg text-warm-700">Features</h2>
        <p className="text-sm text-warm-400 mt-0.5">
          Enable or disable optional features
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-cream-300 bg-cream-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
              <ScanLine className="w-5 h-5 text-amber-dark" />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-600">
                Receipt Scanning
              </p>
              <p className="text-xs text-warm-400">
                Add a Scan button to mobile navigation for capturing receipts
              </p>
            </div>
          </div>

          {user.roleScanEnabled ? (
            <button
              type="button"
              role="switch"
              aria-checked={user.receiptScanEnabled}
              disabled={saving}
              onClick={handleToggle}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30 disabled:opacity-50 disabled:cursor-not-allowed",
                user.receiptScanEnabled ? "bg-amber" : "bg-cream-300"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                  user.receiptScanEnabled ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          ) : (
            <span className="text-xs text-warm-400 bg-cream-200 px-3 py-1 rounded-full">
              Not available
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-cream-300 bg-cream-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
              <Mail className="w-5 h-5 text-amber-dark" />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-600">
                Email Bill Reminders
              </p>
              <p className="text-xs text-warm-400">
                Receive an email when bills are due based on your reminder settings
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={user.emailBillReminders}
            disabled={savingEmailReminders}
            onClick={handleEmailRemindersToggle}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30 disabled:opacity-50 disabled:cursor-not-allowed",
              user.emailBillReminders ? "bg-amber" : "bg-cream-300"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                user.emailBillReminders ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-cream-300 bg-cream-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
              <Rows3 className="w-5 h-5 text-amber-dark" />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-600">
                Infinite Scroll
              </p>
              <p className="text-xs text-warm-400">
                Load transactions as you scroll instead of using page navigation
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={user.transactionLayout === "infinite"}
            disabled={savingLayout}
            onClick={handleLayoutToggle}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30 disabled:opacity-50 disabled:cursor-not-allowed",
              user.transactionLayout === "infinite" ? "bg-amber" : "bg-cream-300"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                user.transactionLayout === "infinite" ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-cream-300 bg-cream-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
              <Target className="w-5 h-5 text-amber-dark" />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-600">
                Auto-focus Amount
              </p>
              <p className="text-xs text-warm-400">
                Focus Amount field first when opening a new transaction form
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={user.transactionAmountAutofocus}
            disabled={savingAutofocus}
            onClick={handleAutofocusToggle}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30 disabled:opacity-50 disabled:cursor-not-allowed",
              user.transactionAmountAutofocus ? "bg-amber" : "bg-cream-300"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                user.transactionAmountAutofocus ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        </div>

        <div className="p-4 rounded-xl border border-cream-300 bg-cream-50/50">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
              <Tag className="w-5 h-5 text-amber-dark" />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-600">
                Default Label Type
              </p>
              <p className="text-xs text-warm-400">
                Default transaction type restriction for newly created labels
              </p>
            </div>
          </div>

          <div className="flex gap-1.5 p-1 bg-cream-100 rounded-xl">
            {(["EXPENSE", "INCOME", "BOTH"] as const).map((type) => (
              <button
                key={type}
                type="button"
                disabled={savingLabelType}
                onClick={() => handleLabelTypeChange(type)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-50",
                  user.defaultLabelType === type
                    ? "bg-white text-warm-700 shadow-warm"
                    : "text-warm-400 hover:text-warm-600"
                )}
              >
                {type === "EXPENSE" ? "Expense" : type === "INCOME" ? "Income" : "Both"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
