/** Shared Recharts styling constants for the warm/cream design language. */

export const AXIS_TICK = { fill: "#8B7E6A", fontSize: 11 };
export const AXIS_TICK_MUTED = { fill: "#B5A898", fontSize: 11 };
export const GRID_STROKE = "#E8DFD0";
export const REFERENCE_STROKE = "#D4C9B8";

export const INCOME_COLOR = "#2D8B5A";
export const EXPENSE_COLOR = "#C44B3F";
export const AMBER_COLOR = "#C8702A";

/** Abbreviate large numbers for Y-axis: 193400 → "193.4K" */
export const formatAbbreviated = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
};
