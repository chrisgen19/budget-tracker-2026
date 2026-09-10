"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface ReturnBarProps {
  /** Built by `analyticsReturnHref` — already validated against a literal path. */
  href: string;
  /** Where the link goes, e.g. "Analytics". */
  label: string;
  /** The view being returned to, e.g. "Sep 1 – 30". Omitted when unknown. */
  context?: string;
}

/**
 * The way back from a drill-down.
 *
 * Rendered into the filter toolbar's first row, which is what keeps it reachable
 * from the bottom of a long list: the toolbar is this page's one sticky element and
 * already knows where to pin, when to hide and when to come back. Not floating at
 * the bottom either — that corner is a coordinated stack (bottom nav, install
 * prompt, bill reminder, FAB) whose offsets are resolved in
 * `bottom-overlay-clearance.ts` with `<main>` padding to match, and it could only
 * show an arrow where this can name the view it returns to.
 *
 * A real link, not `router.back()`. An installed PWA opened cold on this URL, or a
 * pasted link, has no history to go back to — and `display: "standalone"` means
 * iOS offers no back affordance of its own, which is the reason this exists.
 */
export function ReturnBar({ href, label, context }: ReturnBarProps) {
  return (
    <Link
      href={href}
      className="group -mx-2 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-lg px-2 text-sm text-warm-400 transition-colors hover:bg-cream-50 hover:text-warm-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/40"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0 text-amber" />
      <span className="font-medium text-warm-600 group-hover:text-warm-700">{label}</span>
      {context && (
        <>
          <span aria-hidden="true" className="text-warm-300">·</span>
          <span className="min-w-0 truncate">{context}</span>
        </>
      )}
    </Link>
  );
}
