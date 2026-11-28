# Dashboard widget parity

Date: 2026-11-28
Branch: `feature/dashboard-widget-parity` (worktree `.claude/worktrees/dashboard-widget-parity`, from `origin/main` at `3f7c262`)

## Intent

The dashboard is where Christian acts, not only where he looks. Three of its widgets are thinner
copies of richer versions elsewhere in the app, and they have drifted:

- **Recent Transactions** is a hand-written copy of the `/transactions` row that never picked up the
  Photo, card and source badges.
- **Spending by Category** is a separate, older chart (`SpendingChart`) with no icons, no counts, no
  drill-down, and no hide-amounts support.
- **Monthly Trend** (`TrendChart`) ignores hide-amounts and has no way into the month it shows.

The goal is that every number on these widgets can be tapped through to the transactions behind it,
each row says which card paid, and privacy mode hides every amount.

## Goals

1. One shared `TransactionRow` used by both `/transactions` and the dashboard, so the two cannot
   drift again.
2. Dashboard Recent Transactions shows the same badges as `/transactions`: Itemized, Photo, Bill,
   card name, and the Claude / Telegram / desktop-app source icons.
3. Dashboard Spending by Category is the Analytics `CategoryBreakdownChart`: category icons,
   transaction counts, total in the donut, every category in a scrolling list, and each row a link
   to that category's transactions for the selected month.
4. Monthly Trend respects hide-amounts, uses the Analytics chart theme and tooltip, and lets you
   pick a month and open its transactions.
5. Hide-amounts masks every amount on all three widgets, including tooltips and axis ticks.

## Non-goals

- Selection, bulk edit, filters and pagination on the dashboard.
- Highlighting the new row after adding a transaction on the dashboard (it already scrolls to the
  list).
- A "back to dashboard" arrow on `/transactions` after a drill-down. `ret` is an Analytics query
  string by design (`analyticsReturnTarget`, `src/lib/analytics-url.ts:116`), and the dashboard is one
  tap away in the tab bar and sidebar. Drill-downs from the dashboard pass no `ret`.
- Narrow-screen layout changes to the row. The `feature/transaction-row-narrow-screens` worktree
  owns that, and this extraction moves the markup without restyling it.
- Balance Trend, Upcoming Bills, Quick Log and the summary cards.
- The Analytics Cash Flow Y-axis ticks, which also show amounts in privacy mode
  (`src/components/analytics/cash-flow-chart.tsx:104`). Follow-up, not this branch.

## Anti-goals

- `/transactions` looking or behaving any differently after the extraction. Selection, highlight
  scroll (`data-transaction-id`, `transactions/page.tsx:430`), label removal and click-to-edit must
  be unchanged.
- A drill-down that lands on a list whose total does not match the number tapped.
- Any amount visible anywhere on the dashboard while hide-amounts is on.

## Constraints

- **API backward compatibility for one release** (`.claude/rules/deploys.md`): an open tab on the
  old build reads the new `/api/dashboard`. Every API change here is additive: new fields only,
  nothing renamed or removed.
- Touch targets at least 44x44px (AGENTS.md, Design).
- Drill-down hrefs come from `buildTransactionsHref` (`src/lib/transaction-filter-url.ts`) and are
  rendered through `DrillDownLink`, never assembled inline.
- Month windows use `monthRange` (`src/lib/analytics-period.ts:47`) so a drill-down describes the
  same calendar days Analytics would.
- Recharts is `2.15.4` in the main checkout. The worktree has no `node_modules` yet: run
  `pnpm install` in it first, and check click-handler types against the installed package.

## Approaches

**Recent Transactions row**

| Approach | Trade-off |
|---|---|
| **A. Extract a shared `TransactionRow` (chosen by Christian)** | One source of truth. Touches the `/transactions` page, so it will conflict with the narrow-screen branch, which is not Christian's. Whoever merges second rebases. |
| B. Reuse only `TransactionRowBadges` on the dashboard | Smallest diff, no conflict, but the two rows keep drifting on everything except badges. |

**Spending by Category**

| Approach | Trade-off |
|---|---|
| **A. Render the Analytics `CategoryBreakdownChart` on the dashboard (my call)** | Exact parity for free and one chart to maintain. Needs the dashboard API to send `id`, `type` and `transactionCount`, plus two small optional props on the chart. |
| B. Extend `SpendingChart` | Keeps the compact top-5 look, but reimplements icons, counts, drill-down and masking a second time. That is the drift this work removes. |

**Monthly Trend drill-down**

| Approach | Trade-off |
|---|---|
| **A. Tap a month to select it, then a link row under the chart opens it (my call)** | The same pattern as the Spending Heatmap footer (`heatmap-footer.tsx`). The tap still shows the tooltip on touch, and the link is a real 44px target. |
| B. Tap a bar to navigate | One fewer tap, but on touch a tap is how the tooltip is read, and bars for small months are tiny. Analytics rejected the same idea for donut slices (`category-breakdown-chart.tsx:84`). |

## Design

### 1. `TransactionRow` (new, `src/components/transactions/transaction-row.tsx`)

The markup from `transactions/page.tsx:819-911` moved into a component, unchanged in classes and
order: category icon, description with `TransactionRowBadges`, category name with
`TransactionLabelPills`, amount and time.

Props (my proposal):

- `tx: TransactionWithCategory`, `currency`, `hideAmounts`, `timezoneOffset`
- `showCreditAccount: boolean`, `showReceiptPhoto: boolean`: the page passes
  `user.creditCardsEnabled` / `user.receiptPhotosEnabled`, as it does today
  (`transactions/page.tsx:862-863`). Props rather than `useUser()` so the row renders in tests
  without providers.
- `onSelect: () => void`: the row click
- `labels`: `onRemove(labelId)`, `removingLabelId`, `removeDisabled`
- `leading?: ReactNode`: slot for the selection checkbox, so the dashboard gets none
- `selected?`, `highlighted?`: the two state tints the page applies today
- Root keeps `data-transaction-id={tx.id}` and the `group` class.

Labels show up to 3 on both pages (the dashboard showed 2). My call: one default is part of the point.

`/transactions` renders `<TransactionRow leading={<TransactionSelectionCheckbox … />} … />`.
The dashboard renders it with no `leading`, `onSelect` opening the edit modal as today.

### 2. `/api/dashboard` (additive)

- `recentTransactions` include gains
  `creditAccount: { select: { id: true, name: true, color: true } }`, matching
  `src/app/api/transactions/route.ts:37`. `receiptPhotoId` and `createdVia` are scalars and already
  come back.
- `categoryBreakdown` items gain `id` (the category id, no suffix), `type: "EXPENSE"` and
  `transactionCount`. `parseCategoryItemId` already handles an id with no suffix by falling back
  to `item.type` (`category-breakdown-chart.tsx:23,52`).
- `monthlyTrend` items gain `monthKey` (`"YYYY-MM"`) and `transactionCount`.

Types: `DashboardStats.categoryBreakdown` becomes `AnalyticsCategoryItem[]`, and `MonthlyTrendItem`
gains the two fields. `CategoryBreakdownItem` is deleted once nothing imports it (today only
`SpendingChart` and `DashboardStats` do).

### 3. Spending by Category

The dashboard renders
`<CategoryBreakdownChart data={stats.categoryBreakdown} range={monthRange(selected month)} … />`.

Changes to `CategoryBreakdownChart`, all optional props so `/analytics` is unchanged:

- `returnTo?: string`: when absent, `ret` is omitted.
- `emptyMessage?` / `emptyHint?`: the dashboard says "No expenses this month" and
  "Add an expense to see where it goes" instead of the Analytics date-range hint.

The dashboard heading stays "Spending by Category". `SpendingChart` is deleted.

### 4. Monthly Trend (new, `src/components/dashboard/monthly-trend-chart.tsx`)

It replaces `TrendChart`, and `src/components/dashboard/charts.tsx` is deleted once both of its
exports are gone.

- Props: `data`, `currency`, `hideAmounts`.
- Theme from `chart-theme.ts` (`AXIS_TICK`, `INCOME_COLOR`, `EXPENSE_COLOR`, `formatAbbreviated`),
  tooltip through `ChartTooltipCard` / `TooltipRow`, empty state through `ChartEmptyState`, and an
  Income / Expenses legend.
- Hide-amounts masks the tooltip values (`${sym} ••••••`) and hides the Y-axis tick labels.
- Selection: clicking or tapping a month column selects it. The selected month's bars stay full
  opacity and the rest dim. Default selection is the latest month, so there is always a link.
- Footer: one `DrillDownLink` row under the chart, at least 44px tall: "November 2026", the
  income and expense totals (masked when hidden), and a chevron. Its label is
  `drillDownLabel(transactionCount, "November 2026")`, and its href is
  `buildTransactionsHref(monthRange(monthKey))` with no `type` and no `ret`.

### 5. Dashboard load error (my call)

Today a failed `useDashboardQuery` renders nothing (`dashboard/page.tsx:535`). It gets the same
`EmptyState` as `/transactions` ("Couldn't load the dashboard", with a "Try again" button calling
`refetch`). This is small, and a dashboard you act from has to say when it failed.

## Testing

- `transaction-row.test.tsx`: badges render behind their flags, hide-amounts masks the amount,
  `leading` renders, `onSelect` fires, label removal does not trigger `onSelect`.
- `monthly-trend-chart.test.tsx`: the default selection is the latest month, the footer href
  carries that month's `from`/`to`, and hide-amounts masks the footer.
- `category-breakdown-chart.test.ts`: no `ret` when `returnTo` is omitted.
- A dashboard API test, if the route has a harness, for the new fields. Otherwise a type-level check
  plus a manual check.
- E2E: `transactions-responsive.spec.ts` and `transaction-highlight.spec.ts` must stay green. They
  cover the extraction.
- Manual: 375px width for all three widgets, with hide-amounts on and off, and every drill-down's
  list total against the number tapped.

## Left to the builder

- Exact Recharts click wiring for month selection (`BarChart onClick` with `activeTooltipIndex` in
  2.15). Verify it against the installed types.
- Whether the footer shows a net figure as well as income and expenses.
- Skeleton tweaks, if the new donut layout changes the card height on phones.

## Risks

- **Merge conflict** with `feature/transaction-row-narrow-screens` on the `/transactions` row. Keep
  the extraction a pure move in its own commit, so a rebase on either side is mechanical.
- **Dashboard card height grows**: the category list can now show every category (it scrolls past
  240px), and Monthly Trend gains a footer row.
- The sibling `budgettrackerdense` app reads the database directly, not `/api/dashboard`, so these
  type changes do not reach it. Checked: no reference to these types in `mcp-server/src`.
