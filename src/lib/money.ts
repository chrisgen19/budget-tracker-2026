/**
 * Round a money figure to centavos.
 *
 * Amounts are stored as `Float`, so any sum of them picks up binary noise: 140 rows totalling
 * 81,578.35 come back as `81578.35000000002`. Round wherever a *sum* leaves the query layer --
 * not individual stored amounts, which already hold what the user typed -- and never round a
 * partial sum mid-loop, which would compound the error the rounding exists to hide.
 *
 * Same formula as `money` in `cash-flow-forecast.ts`.
 */
export const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;
