import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  /**
   * Static supporting copy. Hidden below `sm`: it never changes, so on a phone it
   * spends a whole line restating what the page title already said.
   */
  description?: string;
  /**
   * Live counts and status. Kept at every width, but inline beside the title on
   * mobile so it costs no extra line, and back under the title from `sm` up.
   */
  meta?: ReactNode;
  /** A chip that belongs to the title, such as the profile page's role badge. */
  badge?: ReactNode;
  /** The page's action or primary control. */
  action?: ReactNode;
  /**
   * Where `action` sits on mobile. `"inline"` puts it on the title row, which is
   * right for a compact control or one that is hidden below `sm` anyway. `"below"`
   * gives it its own full-width row, for a control that needs the width: the period
   * picker's label would truncate to nothing beside a title. This is about layout
   * width, not hit area — an inline control still owes the 44px rule, which it pays
   * with a pseudo-element (see the dashboard's month arrows) rather than by growing.
   */
  actionPlacement?: "inline" | "below";
  headingRef?: Ref<HTMLHeadingElement>;
  /** Set where focus is moved to the heading programmatically. */
  focusable?: boolean;
}

/**
 * The one page header for every page inside the app shell. Seven pages had this
 * hand-written with four different wrappers and three different title sizes, so
 * the mobile treatment lives here rather than as a convention to re-apply.
 */
export function PageHeader({
  title,
  description,
  meta,
  badge,
  action,
  actionPlacement = "inline",
  headingRef,
  focusable = false,
}: PageHeaderProps) {
  const below = actionPlacement === "below";

  return (
    <div
      className={cn(
        "flex gap-3 mb-4 sm:mb-6 sm:gap-4",
        below
          ? "flex-col sm:flex-row sm:items-center sm:justify-between"
          : "items-center justify-between",
      )}
    >
      <div className="flex min-w-0 items-baseline gap-3 sm:block">
        <div className="flex min-w-0 items-center gap-3">
          <h1
            ref={headingRef}
            tabIndex={focusable ? -1 : undefined}
            className="truncate font-serif text-xl text-warm-700 outline-none sm:text-2xl lg:text-3xl"
          >
            {title}
          </h1>
          {badge}
        </div>
        {meta ? <p className="shrink-0 text-sm text-warm-400 sm:mt-1">{meta}</p> : null}
        {description ? (
          <p className="hidden text-sm text-warm-400 sm:mt-1 sm:block">{description}</p>
        ) : null}
      </div>
      {action ? (
        below ? (
          action
        ) : (
          <div className="flex shrink-0 items-center gap-3">{action}</div>
        )
      ) : null}
    </div>
  );
}
