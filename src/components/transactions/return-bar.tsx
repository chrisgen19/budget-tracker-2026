"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn, TOUCH_HIT_AREA_CENTERED } from "@/lib/utils";

interface ReturnBarProps {
  /** Built by `analyticsReturnTarget` — already validated against a literal path. */
  href: string;
  /** Where the link goes, e.g. "Analytics". Read out, not drawn. */
  label: string;
  className?: string;
}

/**
 * The way back from a drill-down: an arrow at the head of the filter toolbar's
 * first row, immediately left of the search box.
 *
 * It used to own a bordered row above the controls and name both its destination
 * and the view it returned to ("Analytics · September 2026"). Both halves were
 * wrong. The row cost a whole line of a phone screen to hold one 16px arrow. And
 * the period named the *analytics* span, which is deliberately not the ledger's
 * own filter — a heatmap drill-down filters the list to one day while the link
 * returns to the whole span — so stepping the transactions period to another month
 * left a back link confidently naming a third one. Two periods on one screen that
 * disagree is worse than one that is unstated.
 *
 * The arrow alone is the convention an installed app is read against, and the
 * destination survives as the accessible name rather than as pixels.
 *
 * Still inside the toolbar, which is this page's one sticky element: on the page
 * heading it would scroll away from a long list. A real link, not `router.back()`,
 * because an installed PWA opened cold on this URL, or a pasted link, has no
 * history to go back to — and `display: "standalone"` means iOS offers no back
 * affordance of its own, which is the reason this exists.
 */
export function ReturnBar({ href, label, className }: ReturnBarProps) {
  return (
    <Link
      href={href}
      aria-label={`Back to ${label}`}
      title={`Back to ${label}`}
      className={cn(
        "relative -ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-amber transition-colors hover:bg-cream-100 hover:text-amber-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/40",
        TOUCH_HIT_AREA_CENTERED,
        className,
      )}
    >
      <ArrowLeft aria-hidden="true" className="h-5 w-5" />
    </Link>
  );
}
