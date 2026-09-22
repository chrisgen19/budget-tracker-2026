"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUser } from "@/components/user-provider";
import { useSavePreference } from "@/hooks/use-save-preference";
import { HH_MM } from "@/lib/validations";

/**
 * The daily Watchlist digest on Telegram: a switch and a send time.
 *
 * Its own component rather than another block in `FeaturesForm`, which was already well past the
 * size target. Rendered only for the bot's owner, the same gate as the evening prompt, since the
 * cron sends to the bot's one chat and to nobody else.
 */
export function TelegramDigestSetting() {
  const { user } = useUser();
  const savePreference = useSavePreference();
  const [savingToggle, setSavingToggle] = useState(false);
  const [savingTime, setSavingTime] = useState(false);

  const handleToggle = async () => {
    setSavingToggle(true);
    await savePreference(
      "telegramWatchlistDigest",
      !user.telegramWatchlistDigest,
      user.telegramWatchlistDigest,
      "the Watchlist digest"
    );
    setSavingToggle(false);
  };

  const handleTimeChange = async (value: string) => {
    // A time input reports "" or "08:" while it is being retyped; the evening prompt's reasoning.
    if (!HH_MM.test(value)) return;
    setSavingTime(true);
    await savePreference("telegramWatchlistDigestTime", value, user.telegramWatchlistDigestTime, "the digest time");
    setSavingTime(false);
  };

  return (
    <div className="p-4 rounded-xl border border-cream-300 bg-cream-50/50">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-light flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-amber-dark" />
          </div>
          <div>
            <p className="text-sm font-medium text-warm-600">Telegram Watchlist Digest</p>
            <p className="text-xs text-warm-400">
              One message a day with new Watchlist alerts that need action: bills and card payments
              due, income that has not arrived, budgets reached. Quiet when nothing is new.
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={user.telegramWatchlistDigest}
          aria-label="Telegram Watchlist Digest"
          disabled={savingToggle}
          onClick={handleToggle}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30 disabled:opacity-50 disabled:cursor-not-allowed",
            "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']",
            user.telegramWatchlistDigest ? "bg-amber" : "bg-cream-300"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
              user.telegramWatchlistDigest ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {user.telegramWatchlistDigest && (
        <div className="mt-4 pt-4 border-t border-cream-300 flex items-center justify-between gap-4">
          <label htmlFor="telegram-digest-time" className="text-xs text-warm-400">
            Send at, in your own timezone
          </label>
          <input
            id="telegram-digest-time"
            type="time"
            value={user.telegramWatchlistDigestTime}
            disabled={savingTime}
            onChange={(e) => handleTimeChange(e.target.value)}
            className="min-h-[44px] appearance-none rounded-lg border border-cream-300 bg-white px-3 py-1.5 text-sm text-warm-600 focus:outline-none focus:ring-2 focus:ring-amber/30 disabled:opacity-50"
          />
        </div>
      )}
    </div>
  );
}
