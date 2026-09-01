"use client";

import { useState } from "react";
import { ScanLine, Mail, Rows3, Target, Tag, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/components/user-provider";
import { useSavePreference } from "@/hooks/use-save-preference";
import { HH_MM } from "@/lib/validations";
import { InstallAppCard } from "@/components/pwa/install-app-card";

export function FeaturesForm() {
  const { user } = useUser();
  // One helper for all seven, because there were seven copies of the same optimistic-update
  // dance and every one of them rolled back in silence.
  const savePreference = useSavePreference();
  const [saving, setSaving] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [savingAutofocus, setSavingAutofocus] = useState(false);
  const [savingLabelType, setSavingLabelType] = useState(false);
  const [savingEmailReminders, setSavingEmailReminders] = useState(false);
  const [savingTelegramPrompt, setSavingTelegramPrompt] = useState(false);
  const [savingPromptTime, setSavingPromptTime] = useState(false);

  const handleToggle = async () => {
    setSaving(true);
    await savePreference(
      "receiptScanEnabled",
      !user.receiptScanEnabled,
      user.receiptScanEnabled,
      "receipt scanning"
    );
    setSaving(false);
  };

  const handleTelegramPromptToggle = async () => {
    setSavingTelegramPrompt(true);
    await savePreference(
      "telegramDailyPrompt",
      !user.telegramDailyPrompt,
      user.telegramDailyPrompt,
      "the Telegram evening prompt"
    );
    setSavingTelegramPrompt(false);
  };

  const handlePromptTimeChange = async (value: string) => {
    // A time input reports "" while the field is cleared, and partial values like "20:" while it
    // is being retyped. The server rejects every one of those, so sending them meant an error
    // toast for an edit still in progress. Silent before this branch existed; visible after, which
    // is the toast doing its job and the reason to stop sending them.
    if (!HH_MM.test(value)) return;

    setSavingPromptTime(true);
    await savePreference(
      "telegramDailyPromptTime",
      value,
      user.telegramDailyPromptTime,
      "the prompt time"
    );
    setSavingPromptTime(false);
  };

  const handleEmailRemindersToggle = async () => {
    setSavingEmailReminders(true);
    await savePreference(
      "emailBillReminders",
      !user.emailBillReminders,
      user.emailBillReminders,
      "email bill reminders"
    );
    setSavingEmailReminders(false);
  };

  const handleLayoutToggle = async () => {
    setSavingLayout(true);
    await savePreference(
      "transactionLayout",
      user.transactionLayout === "infinite" ? "pagination" : "infinite",
      user.transactionLayout,
      "the transaction layout"
    );
    setSavingLayout(false);
  };

  const handleAutofocusToggle = async () => {
    setSavingAutofocus(true);
    await savePreference(
      "transactionAmountAutofocus",
      !user.transactionAmountAutofocus,
      user.transactionAmountAutofocus,
      "amount autofocus"
    );
    setSavingAutofocus(false);
  };

  const handleLabelTypeChange = async (newValue: "EXPENSE" | "INCOME" | "BOTH") => {
    if (newValue === user.defaultLabelType) return;

    setSavingLabelType(true);
    await savePreference("defaultLabelType", newValue, user.defaultLabelType, "the default label type");
    setSavingLabelType(false);
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
                // The visible track is 24px tall; this extends the *tap* target to 44px without
                // moving anything. Growing the track itself would have changed five rows of a
                // settings page to fix a finger-sized problem.
                "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']",
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

          {user.emailVerified ? (
            <button
              type="button"
              role="switch"
              aria-checked={user.emailBillReminders}
              disabled={savingEmailReminders}
              onClick={handleEmailRemindersToggle}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30 disabled:opacity-50 disabled:cursor-not-allowed",
                // The visible track is 24px tall; this extends the *tap* target to 44px without
                // moving anything. Growing the track itself would have changed five rows of a
                // settings page to fix a finger-sized problem.
                "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']",
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
          ) : (
            <span className="text-xs text-warm-400 bg-cream-200 px-3 py-1 rounded-full">
              Verify email
            </span>
          )}
        </div>

        {user.telegramPromptAvailable && (
        <div className="p-4 rounded-xl border border-cream-300 bg-cream-50/50">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
                <Send className="w-5 h-5 text-amber-dark" />
              </div>
              <div>
                <p className="text-sm font-medium text-warm-600">
                  Telegram Evening Prompt
                </p>
                <p className="text-xs text-warm-400">
                  One weekday message asking about your commute and lunch. Stays quiet when
                  both are already logged.
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={user.telegramDailyPrompt}
              disabled={savingTelegramPrompt}
              onClick={handleTelegramPromptToggle}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30 disabled:opacity-50 disabled:cursor-not-allowed",
                // The visible track is 24px tall; this extends the *tap* target to 44px without
                // moving anything. Growing the track itself would have changed five rows of a
                // settings page to fix a finger-sized problem.
                "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']",
                user.telegramDailyPrompt ? "bg-amber" : "bg-cream-300"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                  user.telegramDailyPrompt ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>

          {user.telegramDailyPrompt && (
            <div className="mt-4 pt-4 border-t border-cream-300 flex items-center justify-between gap-4">
              <label htmlFor="telegram-prompt-time" className="text-xs text-warm-400">
                Send at, in your own timezone
              </label>
              <input
                id="telegram-prompt-time"
                type="time"
                value={user.telegramDailyPromptTime}
                disabled={savingPromptTime}
                onChange={(e) => handlePromptTimeChange(e.target.value)}
                className="min-h-[44px] appearance-none rounded-lg border border-cream-300 bg-white px-3 py-1.5 text-sm text-warm-600 focus:outline-none focus:ring-2 focus:ring-amber/30 disabled:opacity-50"
              />
            </div>
          )}
        </div>
        )}

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
                // The visible track is 24px tall; this extends the *tap* target to 44px without
                // moving anything. Growing the track itself would have changed five rows of a
                // settings page to fix a finger-sized problem.
                "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']",
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
                // The visible track is 24px tall; this extends the *tap* target to 44px without
                // moving anything. Growing the track itself would have changed five rows of a
                // settings page to fix a finger-sized problem.
                "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']",
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

        <InstallAppCard />

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
                  "min-h-[44px] flex-1 py-2 rounded-lg text-xs font-medium transition-all duration-200 disabled:opacity-50",
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
