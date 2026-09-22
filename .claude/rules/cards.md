---
paths:
  - src/lib/credit-account-queries.ts
  - src/lib/credit-account-writes.ts
  - src/lib/credit-account-http.ts
  - src/lib/credit-card-access.ts
  - src/lib/card-purchase-rule.ts
  - src/lib/card-owed.ts
  - src/lib/card-interest.ts
  - src/lib/debt-payoff.ts
  - src/lib/cash-flow-forecast.ts
  - "src/app/api/cash-flow-forecast/**"
  - "src/app/api/analytics/debt/**"
  - src/components/analytics/debt-analytics.tsx
  - src/hooks/use-debt-analytics.ts
  - "src/app/api/credit-accounts/**"
  - "src/app/api/admin/feature-access/**"
  - "src/app/(app)/cards/**"
  - "src/components/credit-accounts/**"
  - src/hooks/use-credit-accounts.ts
  - src/hooks/use-card-purchase-batch.ts
  - src/lib/default-categories.ts
---

# Credit Cards

Moved out of `AGENTS.md` verbatim when that file reached the size Codex silently truncates at.

## Key Patterns

- **A card purchase is spending; paying the card is not.** A purchase is an ordinary EXPENSE
  transaction carrying `credit_account_id` ("Paid with" on the form), so it reaches every category
  and label report, search, the assessment and MCP on the day it was bought, with no card-specific
  code in any of them. Paying the card, or a refund it issues, is a `CreditPayment` row, kept out of
  `transactions` entirely so no expense query needs a filter to avoid counting the money twice. What
  a card owes is `opening_balance + purchases - payments - credits`, derived on every read
  (`src/lib/credit-account-queries.ts`). The dashboard's Running Balance falls when a purchase is
  made; its "Owed on cards" line (up to the end of the month shown) is what is left to pay the banks,
  so cash in the bank is that balance plus it, less the cards' opening balances, which were never
  logged as spending. The one rule for linking a row to a
  card is `checkCardPurchases` (`src/lib/card-purchase-rule.ts`): an expense, on the caller's own
  card, and an archived card takes no new purchases while its existing ones stay editable.
  This replaced a first version (#318) that kept statement lines in `credit_charges` and counted
  only the payment, which hid card spending from every category and label report; migration
  `20260915120000_card_purchases_are_transactions` converts that data. Who sees cards is a
  switch on /admin/settings (`site_settings.credit_cards_access`, "Admin only" until changed,
  and a missing row reads as that): `canUseCreditCards` in `src/lib/credit-card-access.ts`. The
  card routes open with `requireCreditCardsUser`, linking a transaction to a card is refused
  without access, and `/cards` has a server layout that redirects; turning it off hides everything
  but deletes nothing. Not yet: card due reminders, and "Paid with" on Telegram, receipt scans,
  quick-log tiles and MCP
- **Interest on a card is spending, and it has no row type of its own.** Interest and fees are an
  ordinary EXPENSE transaction carrying `credit_account_id`, exactly like a purchase, because the
  money genuinely left: a row that raised the balance from outside `transactions` is what #318 did
  with `credit_charges` and what #323 had to undo. They are told apart from purchases by their
  category alone (`INTEREST_CATEGORY_NAME` in `src/lib/card-interest.ts`, matched by **name** so a
  user's own same-named category counts too), so there is no column and no migration. The card page
  reports two figures, not one: what was charged this month, and whether anything has **ever** been
  logged on that card. A card that has never had interest logged reads "not tracked", never "0" —
  `computeAccountBalance` knows nothing about interest, so while none is logged the derived balance
  drifts below the statement every cycle, and a zero would present that drift as a card that costs
  nothing to carry. `describeCardInterest` owns that distinction and is the only place it is made
- **A card's interest terms are nullable, and absent is not zero.** `apr`, `minimum_payment_pct`,
  `minimum_payment_floor` and `planned_payment` (migration `20260921060000`) all read null as
  *unknown*, and every projection that needs one is withheld rather than computed with a stand-in.
  A payoff date worked out at 0% on a card actually charging 36% is not a cautious estimate, it is
  a different card -- the same rule `computeCashForecast` applies to `runningBalance` and
  `savings-goals.ts` applies to a goal with no `target_date`. `apr: 0` is therefore a **real
  value**, meaning a genuine 0% installment plan, and is why none of the four carry a default.
  The minimum is two columns because banks bill the greater of a percentage and a fixed floor
  ("5% of outstanding or 500, whichever is higher"); one flat figure drifts wrong as the balance
  falls, which is the entire span a payoff projection covers. `planned_payment` is the one figure
  here the user chooses rather than the app observes
- **Utilization is derived, never stored, and never clamped.** `utilizationOf` in
  `src/lib/card-interest.ts` is `balance / credit_limit` as a percentage, `null` when there is no
  limit *and* when the limit is zero -- a card with no limit has no ratio, and dividing by zero
  would print `Infinity` as though it were a figure. It is deliberately not clamped to 0-100: being
  **over** the limit is the most useful thing the number can say and a clamp renders it identically
  to sitting exactly on it, while a card holding a credit reads below zero. It is a percentage
  rather than an amount, so Hide Amounts does not mask it: on its own it discloses nothing without
  the limit beside it, which is masked. **Only the bar clamps.** `/cards` draws a progress bar and
  `limitBarPercent` rounds and clamps it to 0-100 for that alone, because a bar has no width past
  full and none below empty; the figure printed beside it is the server's `account.utilization`
  untouched. That page briefly had its own clamped implementation and so disagreed with
  `/cards/[id]` in exactly the two cases this rule exists to preserve -- 108.3% read as "100%" on
  one page and correctly on the other. One ratio, derived once on the server
- **A payoff is three answers, and each is withheld on its own account.** `src/lib/debt-payoff.ts`
  is pure, with no Prisma, and `comparePayoffs` returns the minimum, the observed average and the
  plan side by side -- the useful reading is the *gap* between what the bank asks, what is actually
  being paid and what was intended, which a single figure cannot show. **Every basis needs an APR**
  and the whole block is withheld without one; beyond that a missing plan hides only the plan.
  Four states, deliberately distinct: `never-clears` when a month ends no lower than it began (a
  percentage-only minimum under the monthly interest is the common case, and "600 months" there
  would be an invented number), `beyond-horizon` when it does fall but not inside `MAX_MONTHS`
  (a balance that *is* clearing must not be told it never will), `settled`, and `unknown` carrying
  the reason so the UI can name what to fix. Interest is charged on the balance **before** the
  payment lands, the pessimistic reading of a cycle: a card that posts payments first costs less
  than this says, never more. `minimumDue` is the greater of the percentage and the floor and never
  more than the balance, recomputed each month from what is **owed** that cycle -- interest
  included, since that is the statement balance a bank bills a percentage of. Handing it the
  pre-interest balance instead caps the tail months short, leaves the interest behind every month
  and makes the minimum basis slower than a flat payment of the same size, corrupting the one
  comparison the feature exists for. It is also why `walk` takes a function rather than an amount.
  Note the break-even is not "percentage equals the monthly rate": paying `p` of `balance * (1 + r)`
  gains ground only above `100r / (1 + r)`, which at 36% APR is 2.91%, so a 3% minimum is
  `beyond-horizon` and a 2% one is `never-clears`
- **The observed average is over months, not over payments, and excludes refunds.**
  `observedMonthlyPayment` divides by `OBSERVED_PAYMENT_MONTHS` (6), so two payments in one month
  and one in the next average to what is really being paid per month rather than to one payment's
  size, and it is null below `MIN_PAYMENTS_FOR_AVERAGE` (3) -- one transfer is not a habit, and a
  payoff date off it presents an accident as a plan. The divisor is the months **actually
  observed**, from the first payment's month to the end of the window, never the window's full
  width: a card two months old would otherwise have its rate divided by six, diluting it to a third
  and dropping it under the interest, so a card being paid down briskly reports as one that never
  clears. That is the rule `savings-goals.ts` already applies by measuring pace from a goal's first
  contribution. The window itself is the six **complete** months before this one and stops at the
  start of the current month -- including the month to date would divide up to seven months of
  payments by six, overstating the average and making it jump when this month's payment posts. The caller passes `kind: PAYMENT` rows only: a
  `CREDIT` is a refund the card issued, not a payment anyone chose to make, and averaging it in
  overstates what is going against the card. The window is anchored to **today**, not to the month
  on screen, so scrolling back to March does not change what the projection says is being paid now
- **The cash-flow forecast pays the cards, and refuses rather than guesses.** `cardPaymentEvents`
  (`src/lib/cash-flow-forecast.ts`) emits a `card-payment` on each card's `due_day`, which was the
  largest known outflow the forecast counted nowhere: a purchase lowers the tracked balance the day
  it is made, while the money leaves the bank only when the card is paid. Three refusals, each
  deliberate. A card with a linked reminder **bill** is skipped, because that bill already emits its
  own event from the same schedule and counting both empties the account twice -- the guard the
  forecast already applies to a recurring charge matching a bill by name. A card with **no due day**
  is skipped and *named in the assumptions*, since the output is the lowest projected balance **and
  the day it falls on**, so a guessed date answers wrongly rather than roughly. A card owing nothing
  is skipped. The amount is the most specific figure the card has -- planned, else observed, else
  the minimum -- and `assumption` says which, because the three mean different things. The balance
  is walked **down** across the horizon and each payment capped at what is left, or ninety days
  would take three 8,000 payments against a 5,000 debt; interest and new purchases are deliberately
  not accrued, both being unknowable here. The whole block is gated on `userCanUseCreditCards`: a
  user the switch excludes must not get a payment line they cannot open or explain
- **Projecting card payments forces the forecast's balance to be cash, not the tracked balance.**
  A purchase is an EXPENSE, so it *already* lowers the tracked balance the day it is made; emitting
  a payment for it as well takes the same money out of the bank twice, and the first cut of the
  forecast did exactly that. So when cards apply, `/api/cash-flow-forecast` excludes rows carrying
  `credit_account_id` from **both** transaction reads and subtracts the `credit_payments` already
  made (real money out, in no `transactions` row and therefore subtracted nowhere else), leaving
  the card's whole balance to be paid off across the horizon. That is this file's own identity
  rearranged -- `cash = tracked + owed - card opening balances` -- which is also why a card's
  opening balance needs no special case: it was never logged as spending, and paying it is cash
  leaving for the first time. The rebase is behind the same `userCanUseCreditCards` gate as the
  events, because doing one without the other drops card spending with nothing paying it back.
  The balance query is bounded to **today** for the same reason the events are: a purchase dated
  next month is not owed yet, and counting it would schedule a payment before it happened. The
  **payments** are bounded to today too: a payment dated next week is outside `paymentsMade` and
  emits no event, so counting it in today's balance made that money vanish from the forecast.
  **Archived cards that still owe are forecast** like any other -- the rebase drops every card's
  purchases from cash, so leaving one out removed its spending with nothing paying it back.
  And a payment made **before** a due date is credited against that due date
  (`paidThisCycle`, counted from the day after `previousDueDate`): it has already left cash, so
  taking the planned amount again on the due date paid one cycle twice
- **The Debt tab reads; `/cards` writes.** `/analytics`'s Debt tab (`/api/analytics/debt`,
  `DebtAnalyticsPanel`) holds only what a single card's page cannot say -- the total owed and its
  trend, interest across every card, and avalanche against snowball -- and has no input field at
  all. Every figure it shows is entered on `/cards`. It is a sibling route rather than a slice of
  `/api/analytics`, which already carries row-count telemetry, following `/api/cash-flow-forecast`,
  and it borrows `MAX_ANALYTICS_RANGE_DAYS` through `debtAnalyticsQuerySchema` rather than setting a
  second span limit that would drift from its siblings'. **Access is gated in three places and all
  three are needed.** The route opens with `requireCreditCardsUser` (403 `FEATURE_DISABLED`); the
  tab is not rendered in the bar (`showCards`), since a tab that 403s is worse than none; and the
  page turns an excluded user's `?tab=debt` into `reports`, because a link from someone with access
  is a real URL and would otherwise land them on a tab missing from their own bar. Archived cards
  are included in the total, the same call `sumOwedOnCards` makes: deleting a card with history
  archives it whatever it still owes. The strategy race (`compareStrategies` in `debt-payoff.ts`)
  spends the **same monthly pool** the forecast assumes -- planned, else observed, else minimum --
  so the two cannot disagree about the money available. **The two orderings can stall
  independently**, and `strategyVerdict` judges each on its own outcome: at 48% APR on 60,000
  with 2,500 a month, highest-rate-first clears in about eleven years while smallest-balance-first
  never does, spending the surplus on the small card while the dear one outgrows the pool. Reading
  a stalled run's zeros as a result once said both orders "come out the same" -- the opposite of
  the truth, in exactly the case where the order matters most -- so a stalled ordering is named,
  never compared as a number, and only when both stall is the amount blamed rather than the order.
  The trend is `owedByMonth`, one forward pass with per-card pointers, over reads bounded at the
  range's end but not its start (the first month needs all history). The bound is only safe
  because the **last point is measured at `to` too**, not at the end of `to`'s month: a range
  ending on the 15th asks what was owed by the 15th, and measuring at the 30th while the reads
  stopped at the 15th left the second half of the month out of a point labelled with all of it.
  Its month cap `MAX_DEBT_TREND_MONTHS` is derived from `MAX_ANALYTICS_RANGE_DAYS`, never written
  by hand: a hand-picked 60 truncated a valid ten-year range half-way with nothing saying so. Its interest window uses the app-wide `Date.UTC(...) + tzOffset * 60000`: bare
  `T00:00:00Z` bounds are UTC's day, and in Manila a charge logged at 07:00 on the 1st would land in
  the previous month
