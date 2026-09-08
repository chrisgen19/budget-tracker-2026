"use client";

import { Eye, EyeOff } from "lucide-react";
import { usePrivacy } from "@/components/privacy-provider";
import { cn } from "@/lib/utils";

/**
 * The app-wide "hide amounts" control.
 *
 * `hideAmounts` masks every figure in the app, not the figures on one page, so the control
 * belongs in the chrome rather than in a page. It used to live on the three dashboard stat cards
 * and nowhere else visible: three buttons for one global setting reads as three independent card
 * toggles, and the four pages that also mask figures - transactions, analytics, bills, labels -
 * offered no affordance at all, so someone looking at a screen of `PHP ••••••` had to guess where
 * the switch was. The profile menu carried one, but two taps behind a menu whose label gives no
 * hint a privacy control is inside it.
 *
 * Reads the context itself rather than taking props, so a mount point is one tag and the two
 * variants cannot drift into disagreeing about the same state.
 */
interface PrivacyToggleProps {
  /** `icon` for the mobile header, `row` for the desktop sidebar footer. */
  variant: "icon" | "row";
  className?: string;
}

export function PrivacyToggle({ variant, className }: PrivacyToggleProps) {
  const { hideAmounts, toggleHideAmounts } = usePrivacy();

  return variant === "icon" ? (
    <IconToggle hideAmounts={hideAmounts} onToggle={toggleHideAmounts} className={className} />
  ) : (
    <RowToggle hideAmounts={hideAmounts} onToggle={toggleHideAmounts} className={className} />
  );
}

interface ToggleViewProps {
  hideAmounts: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * `aria-label` is deliberately fixed while `title` names the action.
 *
 * A label that swaps between "Hide amounts" and "Show amounts" makes the button's *state* the
 * thing a screen reader has to infer from its name, and it changes under the user mid-focus.
 * `aria-pressed` says the state properly, so the name can stay the thing the control is.
 */
function IconToggle({ hideAmounts, onToggle, className }: ToggleViewProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Hide amounts"
      aria-pressed={hideAmounts}
      title={hideAmounts ? "Show amounts" : "Hide amounts"}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-warm-400 transition-colors",
        "hover:bg-cream-100 hover:text-warm-600",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60",
        className
      )}
    >
      {hideAmounts ? (
        <EyeOff aria-hidden="true" className="h-5 w-5" />
      ) : (
        <Eye aria-hidden="true" className="h-5 w-5" />
      )}
    </button>
  );
}

/** Sidebar row. Matches the preference switches in Profile > Preferences, hit-area trick included. */
function RowToggle({ hideAmounts, onToggle, className }: ToggleViewProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-2 py-2", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {hideAmounts ? (
          <EyeOff aria-hidden="true" className="h-5 w-5 shrink-0 text-warm-400" />
        ) : (
          <Eye aria-hidden="true" className="h-5 w-5 shrink-0 text-warm-400" />
        )}
        <span className="truncate text-sm font-medium text-warm-600">Hide amounts</span>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={hideAmounts}
        aria-label="Hide amounts"
        onClick={onToggle}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/30",
          // Extends the tap target to 44px without moving the 24px track. See AGENTS.md.
          "before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']",
          hideAmounts ? "bg-amber" : "bg-cream-300"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
            hideAmounts ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );
}
