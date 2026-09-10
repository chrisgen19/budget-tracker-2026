"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DrillDownLinkProps {
  /** Built with `buildTransactionsHref` — never assembled inline. */
  href: string;
  /** Spoken label, since the visible row is a number and an icon, not a sentence. */
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * The affordance every breakdown drill-down shares: a hover tint, a visible focus
 * ring, and a row that is a real link (middle-click and copy-link work, and the
 * status bar previews where it goes).
 *
 * Deliberately thin. The three surfaces behind it — a category row, a label bar, a
 * heatmap day — look nothing alike, so what is worth sharing is the behaviour and
 * the styling of the target, not a component that tries to render all three.
 */
export function DrillDownLink({ href, label, className, children }: DrillDownLinkProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      // One analytics page carries ~19 of these, each a distinct query string and
      // so a distinct prefetch cache key, all pointing at a dynamic authenticated
      // route. Prefetching would put that many RSC requests through middleware and
      // a session check for a shell the target discards anyway — /transactions
      // fetches its rows client-side through React Query.
      prefetch={false}
      className={cn(
        "block rounded-lg transition-colors hover:bg-cream-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/40",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** "View 3 transactions for Utilities" — one phrasing across all three surfaces. */
export const drillDownLabel = (count: number, subject: string) =>
  `View ${count} ${count === 1 ? "transaction" : "transactions"} for ${subject}`;
