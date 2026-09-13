/**
 * The React Query key for the label list, extracted so it can be imported without the hooks.
 *
 * `use-labels.ts` imports `quickTileKeys` (a label edit changes a tile's pins), and `use-quick-tiles.ts`
 * now imports this (a quick-log tap changes the per-label transaction counts the picker ranks by).
 * Left in place that is a cycle. It happens to resolve today, because both key objects are only read
 * inside mutation callbacks rather than at module scope -- but that is a property of where the reads
 * happen, not of the imports, and moving one read to module scope would break it at load time with a
 * TDZ error rather than anything that names the cycle.
 *
 * `use-labels.ts` re-exports this, so existing importers are unaffected.
 */
export const labelKeys = {
  all: ["labels"] as const,
};
