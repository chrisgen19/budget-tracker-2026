/**
 * How often a recurring charge comes back, in words a person would use.
 *
 * Its own module with no imports, so the analytics card can use it without pulling the whole of
 * `assessment-facts.ts` into the browser bundle -- the same reason `card-owed.ts` stands alone.
 */

/**
 * The measured gap, named when it sits near a cycle people recognise, and given in days when it does
 * not. Before #360 every recurring charge was monthly or faster, so the card could say "month after
 * month" of all of them; a yearly subscription described that way reads as something it is not.
 * Null without a measurable gap, where the caller keeps whatever it said before.
 */
export const cadenceLabel = (intervalDays: number | null): string | null => {
  if (intervalDays === null) return null;
  const near = (target: number, slack: number) => Math.abs(intervalDays - target) <= slack;
  if (intervalDays <= 1) return "daily";
  if (near(7, 1)) return "weekly";
  if (near(14, 2)) return "every 2 weeks";
  if (near(30, 4)) return "monthly";
  if (near(61, 7)) return "every 2 months";
  if (near(91, 11)) return "quarterly";
  if (near(182, 22)) return "every 6 months";
  if (near(365, 35)) return "yearly";
  return `every ${intervalDays} days`;
};
