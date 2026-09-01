"use client";

import { useMemo, useState } from "react";
import { Calendar, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/components/user-provider";
import { useSavePreference } from "@/hooks/use-save-preference";

const DAY_FORMAT_OPTIONS = [
  { value: "SHORT" as const, label: "Short", example: "Mon" },
  { value: "FULL" as const, label: "Full", example: "Monday" },
];

export function PreferencesForm() {
  const { user } = useUser();
  // The same saver the Features tab uses. These two were the copies missed on the first pass,
  // which is the argument for there being one path rather than a convention to follow.
  const savePreference = useSavePreference();
  const [savingDayName, setSavingDayName] = useState(false);
  const [savingDayFormat, setSavingDayFormat] = useState(false);

  const previewDate = useMemo(() => {
    const now = new Date();
    const formatted = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const dayFull = now.toLocaleDateString("en-US", { weekday: "long" });
    const dayShort = now.toLocaleDateString("en-US", { weekday: "short" });
    return { formatted, dayFull, dayShort };
  }, []);

  const handleDayNameToggle = async () => {
    setSavingDayName(true);
    await savePreference("showDayName", !user.showDayName, user.showDayName, "the day name setting");
    setSavingDayName(false);
  };

  const handleDayFormatChange = async (newValue: "FULL" | "SHORT") => {
    if (newValue === user.dayNameFormat) return;

    setSavingDayFormat(true);
    await savePreference("dayNameFormat", newValue, user.dayNameFormat, "the day name format");
    setSavingDayFormat(false);
  };

  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="font-serif text-lg text-warm-700">Preferences</h2>
        <p className="text-sm text-warm-400 mt-0.5">
          Date headers and formatting options
        </p>
      </div>

      <div className="space-y-4">
        {/* Show Day Name toggle */}
        <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-cream-300 bg-cream-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
              <Calendar className="w-5 h-5 text-amber-dark" />
            </div>
            <div>
              <p className="text-sm font-medium text-warm-600">
                Show Day Name
              </p>
              <p className="text-xs text-warm-400">
                Display the day of the week on date headers
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={user.showDayName}
            disabled={savingDayName}
            onClick={handleDayNameToggle}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30 disabled:opacity-50 disabled:cursor-not-allowed",
              // Extends the tap target to 44px without moving the 24px track. See AGENTS.md.
              "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']",
              user.showDayName ? "bg-amber" : "bg-cream-300"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                user.showDayName ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        </div>

        {/* Day Name Format */}
        {user.showDayName && (
          <div className="p-4 rounded-xl border border-cream-300 bg-cream-50/50">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center">
                <Type className="w-5 h-5 text-amber-dark" />
              </div>
              <div>
                <p className="text-sm font-medium text-warm-600">
                  Day Name Format
                </p>
                <p className="text-xs text-warm-400">
                  Choose between short or full day names
                </p>
              </div>
            </div>

            <div className="flex gap-2 ml-[52px]">
              {DAY_FORMAT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleDayFormatChange(option.value)}
                  disabled={savingDayFormat}
                  className={cn(
                    "min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50",
                    user.dayNameFormat === option.value
                      ? "bg-amber text-white shadow-soft"
                      : "bg-cream-200 text-warm-500 hover:bg-cream-300"
                  )}
                >
                  {option.example}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Preview */}
        {user.showDayName && (
          <div className="p-4 rounded-xl border border-dashed border-cream-300 bg-cream-50/30">
            <p className="text-[10px] text-warm-300 uppercase tracking-wider mb-2">Preview</p>
            <div className="flex items-center gap-2 px-4 py-2.5 bg-cream-50 border border-cream-200 rounded-lg">
              <span className="text-xs font-semibold text-warm-500 uppercase tracking-wide">
                {previewDate.formatted}
                <span className="text-warm-300 font-normal normal-case tracking-normal ml-1.5">
                  · {user.dayNameFormat === "FULL" ? previewDate.dayFull : previewDate.dayShort}
                </span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
