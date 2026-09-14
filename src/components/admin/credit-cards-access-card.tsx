"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Access = "ADMIN" | "EVERYONE";

const OPTIONS: { value: Access; label: string; hint: string }[] = [
  { value: "ADMIN", label: "Admin only", hint: "Only admins see Cards and Paid with." },
  { value: "EVERYONE", label: "Everyone", hint: "Every user can track credit cards." },
];

/**
 * The credit cards switch on /admin/settings.
 *
 * Saves optimistically and puts the old value back if the save fails, saying so. Turning it off
 * hides cards from regular users without touching their data: their card purchases stay ordinary
 * expenses, and switching back on restores everything.
 */
export function CreditCardsAccessCard() {
  const [access, setAccess] = useState<Access | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/feature-access")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((data: { creditCardsAccess: Access }) => setAccess(data.creditCardsAccess))
      .catch(() => setLoadFailed(true));
  }, []);

  const choose = async (next: Access) => {
    if (access === null || next === access || saving) return;
    const previous = access;
    setAccess(next);
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/feature-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditCardsAccess: next }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      setAccess(previous);
      setError("Couldn't save. The previous setting is still in effect.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-cream-300/60 shadow-soft overflow-hidden">
      <div className="px-5 py-4 border-b border-cream-200">
        <h2 className="font-serif text-lg text-warm-700">Features</h2>
        <p className="text-xs text-warm-400 mt-0.5">Switches that apply to every user at once</p>
      </div>

      <div className="p-5">
        <div className="flex flex-col gap-3 p-4 rounded-xl border border-cream-300 bg-cream-50/50 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-amber-light flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-amber-dark" />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-600">Credit Cards</p>
              <p className="text-xs text-warm-400">
                {loadFailed
                  ? "Couldn't load this setting. Reload to try again."
                  : OPTIONS.find((option) => option.value === access)?.hint ?? "Loading…"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {saving && <Loader2 aria-hidden="true" className="w-4 h-4 text-warm-300 animate-spin" />}
            <div role="radiogroup" aria-label="Who can use credit cards" className="flex gap-1 rounded-xl bg-cream-200/60 p-1">
              {OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={access === option.value}
                  disabled={access === null || saving}
                  onClick={() => void choose(option.value)}
                  className={cn(
                    "min-h-11 rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed",
                    access === option.value ? "bg-white text-warm-700 shadow-soft" : "text-warm-400 hover:text-warm-600"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {error && <p className="mt-2 text-sm text-expense">{error}</p>}
      </div>
    </div>
  );
}
