"use client";

import { useEffect, useState } from "react";
import { ScanLine, ImagePlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@prisma/client";

interface RoleSettings {
  receiptScanEnabled: boolean;
  maxUploadFiles: number;
}

type SettingsMap = Partial<Record<UserRole, RoleSettings>>;

const ROLE_LABELS: Record<string, { title: string; description: string }> = {
  FREE: {
    title: "Free Users",
    description: "Default settings for users on the free tier",
  },
  PAID: {
    title: "Paid Users",
    description: "Default settings for users on the paid tier",
  },
};

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch("/api/admin/settings");
        if (!res.ok) throw new Error("Failed to fetch settings");
        const data = await res.json();
        setSettings(data);
      } catch {
        setError("Failed to load settings. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const updateSetting = async (
    role: "FREE" | "PAID",
    field: keyof RoleSettings,
    value: boolean | number
  ) => {
    const key = `${role}-${field}`;
    const prev = settings[role];
    if (!prev) return;

    // Optimistic update
    setSettings((s) => ({
      ...s,
      [role]: { ...prev, [field]: value },
    }));
    setSavingKey(key);

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, [field]: value }),
      });

      if (!res.ok) {
        // Revert on failure
        setSettings((s) => ({ ...s, [role]: prev }));
        setError("Failed to save. Please try again.");
      }
    } catch {
      setSettings((s) => ({ ...s, [role]: prev }));
      setError("Network error. Please try again.");
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="bg-white rounded-2xl border border-cream-300/60 p-6 shadow-soft"
          >
            <div className="space-y-4">
              <div className="h-5 w-32 bg-cream-200 rounded-lg animate-pulse" />
              <div className="h-4 w-56 bg-cream-100 rounded-lg animate-pulse" />
              <div className="h-12 bg-cream-100 rounded-xl animate-pulse" />
              <div className="h-12 bg-cream-100 rounded-xl animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-expense-light border border-expense/20 text-expense rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {(["FREE", "PAID"] as const).map((role) => {
        const roleSettings = settings[role];
        if (!roleSettings) return null;

        const label = ROLE_LABELS[role];

        return (
          <div
            key={role}
            className="bg-white rounded-2xl border border-cream-300/60 shadow-soft overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-cream-200">
              <h2 className="font-serif text-lg text-warm-700">
                {label.title}
              </h2>
              <p className="text-xs text-warm-400 mt-0.5">
                {label.description}
              </p>
            </div>

            <div className="p-5 space-y-4">
              {/* Receipt Scan Toggle */}
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
                      Allow {role.toLowerCase()} users to scan receipts
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {savingKey === `${role}-receiptScanEnabled` && (
                    <Loader2 className="w-4 h-4 text-warm-300 animate-spin" />
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={roleSettings.receiptScanEnabled}
                    onClick={() =>
                      updateSetting(
                        role,
                        "receiptScanEnabled",
                        !roleSettings.receiptScanEnabled
                      )
                    }
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30",
                      roleSettings.receiptScanEnabled
                        ? "bg-amber"
                        : "bg-cream-300"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                        roleSettings.receiptScanEnabled
                          ? "translate-x-5"
                          : "translate-x-0"
                      )}
                    />
                  </button>
                </div>
              </div>

              {/* Max Upload Files */}
              <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-cream-300 bg-cream-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
                    <ImagePlus className="w-5 h-5 text-amber-dark" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-warm-600">
                      Max Files Per Upload
                    </p>
                    <p className="text-xs text-warm-400">
                      Maximum receipt images per batch scan (1–50)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {savingKey === `${role}-maxUploadFiles` && (
                    <Loader2 className="w-4 h-4 text-warm-300 animate-spin" />
                  )}
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={roleSettings.maxUploadFiles}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val >= 1 && val <= 50) {
                        updateSetting(role, "maxUploadFiles", val);
                      }
                    }}
                    className="w-20 px-3 py-2 rounded-xl border border-cream-300 bg-cream-50/50 text-warm-700 text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber transition-all"
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
