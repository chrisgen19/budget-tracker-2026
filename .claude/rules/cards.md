---
paths:
  - src/lib/credit-account-queries.ts
  - src/lib/credit-account-writes.ts
  - src/lib/credit-account-http.ts
  - src/lib/credit-card-access.ts
  - src/lib/card-purchase-rule.ts
  - src/lib/card-owed.ts
  - src/lib/card-interest.ts
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
  the limit beside it, which is masked
