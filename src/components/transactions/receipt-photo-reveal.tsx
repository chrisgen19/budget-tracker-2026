"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { usePrivacy } from "@/components/privacy-provider";

/**
 * A receipt prints every amount on it, so with hide-amounts on a photo is blurred like any
 * other figure. A tap reveals this one instance for the rest of its life; it never touches
 * the global setting, which would show every amount in the app to read one receipt.
 */
export function usePhotoReveal() {
  const { hideAmounts } = usePrivacy();
  const [revealed, setRevealed] = useState(false);
  return { blurred: hideAmounts && !revealed, reveal: () => setRevealed(true) };
}

/** The tap target over a blurred photo. Stops propagation so revealing never also opens it. */
export function PhotoRevealCover({ onReveal }: { onReveal: () => void }) {
  return (
    <button
      type="button"
      aria-label="Show photo"
      onClick={(event) => {
        event.stopPropagation();
        onReveal();
      }}
      className="absolute inset-0 z-10 flex items-center justify-center"
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warm-900/70 px-3 py-1.5 text-xs text-cream-50">
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        Tap to show
      </span>
    </button>
  );
}
