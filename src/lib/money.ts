/**
 * Round a money figure to centavos.
 *
 * Amounts are stored as `Float`, so any sum of them picks up binary noise: 140 rows totalling
 * 81,578.35 come back as `81578.35000000002`. Round wherever a *sum* leaves the query layer --
 * not individual stored amounts, which already hold what the user typed -- and never round a
 * partial sum mid-loop, which would compound the error the rounding exists to hide.
 *
 * Rounds the magnitude half away from zero, then restores the sign. `Math.round` alone rounds
 * halves toward +Infinity, so -1.005 became -1 while 1.005 became 1.01, and a net derived from a
 * rounded expense total stopped equalling income minus expenses.
 */
export const roundMoney = (value: number): number => {
  const rounded = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  // `|| 0` folds the -0 that tiny negative noise rounds to: it serialises as 0 but fails `Object.is`.
  return Math.sign(value) * rounded || 0;
};
