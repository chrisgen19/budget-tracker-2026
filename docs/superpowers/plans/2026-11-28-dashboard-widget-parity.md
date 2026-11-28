# Dashboard Widget Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the dashboard's Recent Transactions, Spending by Category and Monthly Trend widgets up to the `/transactions` and `/analytics` versions, with drill-down links, card badges and full hide-amounts masking.

**Architecture:** Extract the `/transactions` row into a shared `TransactionRow`. Render the Analytics `CategoryBreakdownChart` on the dashboard. Replace `TrendChart` with a themed `MonthlyTrendChart` that has a select-then-open footer link. The dashboard API's aggregation moves into pure helpers so the new fields are testable, and every API change only adds fields.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma, Recharts 2.15.4, Tailwind, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-28-dashboard-widget-parity-design.md`

## Global Constraints

- Work only in `/Users/chrisgen19/projects/budgettracker/.claude/worktrees/dashboard-widget-parity`, on branch `feature/dashboard-widget-parity`. Run `pnpm install` there first, since the worktree has no `node_modules`.
- `/api/dashboard` changes only add fields. Nothing is renamed or removed, because an open tab on the previous build reads the new response for one release (`.claude/rules/deploys.md`).
- Touch targets are at least 44x44px.
- Drill-down hrefs come only from `buildTransactionsHref` (`src/lib/transaction-filter-url.ts`) and render through `DrillDownLink`. Dashboard drill-downs pass no `ret`.
- Hide-amounts mask string: `${getCurrencySymbol(currency)} ••••••` (the row amount keeps its existing `••••`).
- No new packages. No `console.log`. Named exports. Files are kebab-case.
- No em dashes or en dashes in new comments, copy or commit messages.
- Before calling a task done: `pnpm lint`, `pnpm type-check`, and `pnpm test`, with no output piped.
- Commits use Conventional Commits.

## Review Focus

1. **Drill-down totals must match.** A category row's link has to land on exactly the rows counted: EXPENSE only, inside the selected month's calendar days. Pinned in Task 1 (EXPENSE-only counts) and Task 4 (href carries `type=EXPENSE` and the month's `from`/`to`).
2. **Changing the dashboard month must move the category links.** The range comes from `currentMonth`, not from today. Pinned in Task 1 (`monthKeyRange`) and Task 4 (the page passes `monthKeyRange(currentMonth)`).
3. **Hide-amounts on the new trend surfaces:** the tooltip, the Y-axis ticks and the footer totals. Pinned in Task 5.
4. **Tapping a label's remove button on a dashboard row must not open the edit modal.** Pinned in Task 2.
5. **A trend month with zero transactions** shows its name and "No transactions" as plain text, not a link to an empty list. Pinned in Task 5.

---

### Task 1: Dashboard aggregates with drill-down fields

**Files:**
- Create: `src/lib/dashboard-aggregates.ts`
- Test: `src/lib/dashboard-aggregates.test.ts`
- Modify: `src/app/api/dashboard/route.ts:68-73` (include), `:128-175` (replace the inline loops with the helpers)
- Modify: `src/types/index.ts:80-105`
- Modify: `src/lib/analytics-period.ts`, `src/lib/analytics-period.test.ts`

**Interfaces:**
- Produces:
  - `buildCategoryBreakdown(rows: { categoryId: string; type: TransactionType; amount: number; category: { name: string; color: string; icon: string } }[], totalExpenses: number): AnalyticsCategoryItem[]`
  - `buildMonthlyTrend(rows: { type: TransactionType; amount: number; date: Date }[], localNow: Date, toLocalMonthKey: (d: Date) => string): MonthlyTrendItem[]`
  - `MonthlyTrendItem` becomes `{ month: string; monthKey: string; income: number; expenses: number; transactionCount: number }`
  - `DashboardStats.categoryBreakdown: AnalyticsCategoryItem[]`
  - `monthKeyRange(monthKey: string): DateRange` in `analytics-period.ts` (`"2026-11"` gives `{ from: "2026-11-01", to: "2026-11-30" }`), built on `monthRange`
  - `recentTransactions[].creditAccount: { id; name; color } | null`

- [ ] **Step 1: Write the failing tests**

`dashboard-aggregates.test.ts`:
- `buildCategoryBreakdown counts only EXPENSE rows`: two EXPENSE rows (100, 50) and one INCOME row in category `c1`. Expect one item `{ id: "c1", type: "EXPENSE", amount: 150, transactionCount: 2, percentage: 100 }`.
- `buildCategoryBreakdown sorts by amount descending and rounds percentage`: `c1` 300, `c2` 100, total 400. Expect ids `["c1", "c2"]` and percentages `[75, 25]`.
- `buildCategoryBreakdown gives 0% when totalExpenses is 0`.
- `buildMonthlyTrend returns six months oldest first with monthKey`: with `localNow = 2026-11-15`, expect `monthKey`s `["2026-06", …, "2026-11"]` and `month` `"Nov 2026"` last.
- `buildMonthlyTrend counts both types in transactionCount`: one INCOME and two EXPENSE rows in November. Expect `{ income, expenses, transactionCount: 3 }`.

`analytics-period.test.ts`:
- `monthKeyRange covers the whole month`: `"2026-11"` gives `{ from: "2026-11-01", to: "2026-11-30" }`, and `"2028-02"` gives `to: "2028-02-29"`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm vitest run src/lib/dashboard-aggregates.test.ts src/lib/analytics-period.test.ts`
Expected: FAIL (module or export not found).

- [ ] **Step 3: Implement the helpers, `monthKeyRange` and the types**

Move the route's existing loop logic into the helpers unchanged, adding `id: categoryId`, `type: "EXPENSE"`, `transactionCount` and `monthKey`. Delete `CategoryBreakdownItem` from `types/index.ts` only after Task 4 removes its last import. For now, leave it in place.

- [ ] **Step 4: Wire up the route**

Call both helpers from `route.ts`. Add `creditAccount: { select: { id: true, name: true, color: true } }` to the `recentTransactions` include.

- [ ] **Step 5: Run the tests, type-check and lint**

Run: `pnpm vitest run src/lib/dashboard-aggregates.test.ts src/lib/analytics-period.test.ts`, then `pnpm type-check`, then `pnpm lint`.
Expected: all pass. The dashboard page still compiles, because `SpendingChart` reads a subset of `AnalyticsCategoryItem`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard-aggregates.ts src/lib/dashboard-aggregates.test.ts src/lib/analytics-period.ts src/lib/analytics-period.test.ts src/app/api/dashboard/route.ts src/types/index.ts
git commit -m "feat(dashboard): add drill-down fields to dashboard aggregates"
```

---

### Task 2: Extract `TransactionRow` (pure move)

**Files:**
- Create: `src/components/transactions/transaction-row.tsx`
- Test: `src/components/transactions/transaction-row.test.tsx`
- Modify: `src/app/(app)/transactions/page.tsx:817-911`

**Interfaces:**
- Produces:

```ts
interface TransactionRowProps {
  tx: TransactionWithCategory;
  currency: string;
  hideAmounts: boolean;
  timezoneOffset: number;
  showCreditAccount: boolean;
  showReceiptPhoto: boolean;
  onSelect: () => void;
  onRemoveLabel?: (labelId: string) => void;
  removingLabelId?: string | null;
  removeLabelDisabled?: boolean;
  /** Rendered before the category icon, e.g. the selection checkbox. */
  leading?: ReactNode;
  selected?: boolean;
  highlighted?: boolean;
  /** Defaults to 3. */
  maxLabels?: number;
}
export function TransactionRow(props: TransactionRowProps): JSX.Element
```

The root is the existing `div`, with the same classes, `data-transaction-id={tx.id}`, the `group` class and `onClick={onSelect}`. Badges come from `TransactionRowBadges`, given `creditAccount` only when `showCreditAccount` is on and `receiptPhotoId` only when `showReceiptPhoto` is on.

- [ ] **Step 1: Write the failing tests** (`transaction-row.test.tsx`, with a local `makeTx()` fixture)
  - `shows the card name only when showCreditAccount`: with `creditAccount { name: "BPI Gold" }`, the text `BPI Gold` is present when the flag is true and absent when it is false.
  - `shows the Photo badge only when showReceiptPhoto`
  - `masks the amount when hideAmounts`: the text `••••` appears and the formatted amount does not.
  - `renders leading content`: `leading={<span>lead</span>}` shows `lead`.
  - `calls onSelect when the row is clicked`
  - `removing a label does not call onSelect`: with one label and `onRemoveLabel` spied, clicking the pill's remove control calls `onRemoveLabel("l1")` and does not call `onSelect`. This pins Review Focus 4.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm vitest run src/components/transactions/transaction-row.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `TransactionRow` by moving the markup out of `transactions/page.tsx`**

Make no class or order changes. The page passes `leading={<TransactionSelectionCheckbox … className="-my-2 -ml-3" />}`, `selected={isSelected}`, `highlighted={highlightedRowId === tx.id}`, `removeLabelDisabled={removeLabelMutation.isPending || selectedItems.length > 0}`, and `onSelect` with its existing toggle-or-edit logic.

- [ ] **Step 4: Run the unit tests and the full suite**

Run: `pnpm vitest run src/components/transactions/transaction-row.test.tsx`, then `pnpm test`.
Expected: PASS.

- [ ] **Step 5: Run the row's E2E specs**

Run: `pnpm exec playwright test e2e/transactions-responsive.spec.ts e2e/transaction-highlight.spec.ts`
Expected: PASS. If the E2E setup needs a running database the local machine lacks, record that in the task report rather than skipping it silently.

- [ ] **Step 6: Commit (the move alone, so a rebase with `feature/transaction-row-narrow-screens` stays mechanical)**

```bash
git add src/components/transactions/transaction-row.tsx src/components/transactions/transaction-row.test.tsx "src/app/(app)/transactions/page.tsx"
git commit -m "refactor(transactions): extract TransactionRow from the transactions page"
```

---

### Task 3: Dashboard Recent Transactions uses `TransactionRow`

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx:438-513`

**Interfaces:**
- Consumes: `TransactionRow` (Task 2) and `recentTransactions[].creditAccount` (Task 1).

- [ ] **Step 1: Replace the hand-written row**

Use `<TransactionRow tx={tx} currency={currency} hideAmounts={hideAmounts} timezoneOffset={user.timezoneOffset} showCreditAccount={user.creditCardsEnabled} showReceiptPhoto={user.receiptPhotosEnabled} onSelect={() => setEditingTransaction(tx)} onRemoveLabel={…} removingLabelId={…} removeLabelDisabled={removeLabelMutation.isPending} />`. Leave out `leading` and use the default `maxLabels`. Remove the imports that become unused (`Receipt`, `CategoryIcon`, `TransactionLabelPills`, `formatTime` if unused).

- [ ] **Step 2: Type-check, lint and test**

Run: `pnpm type-check`, then `pnpm lint`, then `pnpm test`.
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): show photo, card and source badges on recent transactions"
```

---

### Task 4: Spending by Category becomes `CategoryBreakdownChart`

**Files:**
- Modify: `src/components/analytics/category-breakdown-chart.tsx:31-60`
- Test: `src/components/analytics/category-breakdown-chart.test.tsx` (new, next to the existing `.test.ts`)
- Modify: `src/app/(app)/dashboard/page.tsx:382-393`
- Modify: `src/components/dashboard/charts.tsx` (delete `SpendingChart`)
- Modify: `src/types/index.ts` (delete `CategoryBreakdownItem`)

**Interfaces:**
- Consumes: `monthKeyRange` (Task 1) and `stats.categoryBreakdown: AnalyticsCategoryItem[]` (Task 1).
- Produces: `CategoryBreakdownChartProps` gains `returnTo?: string`, `emptyMessage?: string` and `emptyHint?: string`. When `returnTo` is omitted, `ret` is left out of the href. The empty-state defaults stay as today's copy.

- [ ] **Step 1: Write the failing tests** (mock `ResponsiveContainer` the way `balance-trend-plot.test.tsx:7-14` does)
  - `omits ret when returnTo is not given`: one item `{ id: "c1", type: "EXPENSE", transactionCount: 2 }` with range `2026-11-01` to `2026-11-30`. The link's href contains `categoryId=c1`, `type=EXPENSE`, `from=2026-11-01` and `to=2026-11-30`, and no `ret=`.
  - `uses the custom empty copy`: with `data=[]`, `emptyMessage="No expenses this month"` is shown.
  - `masks amounts when hideAmounts`: no formatted amount text is present.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm vitest run src/components/analytics/category-breakdown-chart.test.tsx`
Expected: FAIL (the `ret` assertion and the empty-copy assertion).

- [ ] **Step 3: Add the optional props**

- [ ] **Step 4: Swap the dashboard over**

Render `<CategoryBreakdownChart data={stats.categoryBreakdown} currency={currency} hideAmounts={hideAmounts} range={monthKeyRange(currentMonth)} emptyMessage="No expenses this month" emptyHint="Add an expense to see where it goes" />`. The chart handles the empty state itself, so drop the page's own empty branch. Delete `SpendingChart` and `CategoryBreakdownItem`.

- [ ] **Step 5: Test, type-check and lint**

Run: `pnpm vitest run src/components/analytics`, then `pnpm type-check`, then `pnpm lint`.
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/analytics/category-breakdown-chart.tsx src/components/analytics/category-breakdown-chart.test.tsx "src/app/(app)/dashboard/page.tsx" src/components/dashboard/charts.tsx src/types/index.ts
git commit -m "feat(dashboard): use the analytics category breakdown with drill-down links"
```

---

### Task 5: `MonthlyTrendChart` with month drill-down

**Files:**
- Create: `src/components/dashboard/monthly-trend-chart.tsx`
- Test: `src/components/dashboard/monthly-trend-chart.test.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx:369-380`
- Delete: `src/components/dashboard/charts.tsx`

**Interfaces:**
- Consumes: `MonthlyTrendItem` with `monthKey` and `transactionCount`, and `monthKeyRange` (Task 1).
- Produces: `export function MonthlyTrendChart({ data, currency, hideAmounts }: { data: MonthlyTrendItem[]; currency: string; hideAmounts: boolean }): JSX.Element`

Behavior (from the spec):
- Theme, tooltip and empty state come from `chart-theme.ts`, `ChartTooltipCard` / `TooltipRow` and `ChartEmptyState`.
- Income and Expenses legend.
- `selectedKey` state, defaulting to the last item's `monthKey`. A click on a month column selects it (`BarChart onClick` with `activeTooltipIndex`; check the event type in `node_modules/recharts/types`). Unselected bars render at 0.35 opacity.
- Footer under the chart, with the full month name ("November 2026", via `Intl.DateTimeFormat` with `month: "long", year: "numeric"`) and income and expense totals:
  - With `transactionCount > 0`: a `DrillDownLink` with `min-h-11`, the label `drillDownLabel(count, "November 2026")`, the href `buildTransactionsHref(monthKeyRange(selectedKey))` and a trailing `ChevronRight`.
  - With `transactionCount === 0`: a plain `div` showing the month name and "No transactions".
- Under hide-amounts: footer and tooltip values use the mask, and the Y-axis `tickFormatter` returns `""`.
- The empty state renders when every month is zero, which replaces the page's current check.

- [ ] **Step 1: Write the failing tests** (with the same `ResponsiveContainer` mock)
  - `defaults the footer to the latest month`: six months ending `2026-11` (count 4). The link named `View 4 transactions for November 2026` has an href containing `from=2026-11-01` and `to=2026-11-30`, and no `type=` or `ret=`.
  - `masks footer totals when hideAmounts`: the mask text is present and `formatCurrency(1234.5, "PHP")` is absent.
  - `shows no link for a month with no transactions`: when the latest month has count 0, there is no `link` role in the footer and `No transactions` is present. This pins Review Focus 5.
  - `renders the empty state when every month is zero`

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm vitest run src/components/dashboard/monthly-trend-chart.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `MonthlyTrendChart`**, swap it into the dashboard and delete `charts.tsx`

- [ ] **Step 4: Test, type-check and lint**

Run: `pnpm vitest run src/components/dashboard`, then `pnpm type-check`, then `pnpm lint`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/monthly-trend-chart.tsx src/components/dashboard/monthly-trend-chart.test.tsx "src/app/(app)/dashboard/page.tsx" src/components/dashboard/charts.tsx
git commit -m "feat(dashboard): add a themed monthly trend with month drill-down"
```

---

### Task 6: Dashboard load-error state and final checks

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx:71,235-535`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the error branch**

Destructure `isError` and `refetch` from `useDashboardQuery`. When `isError` is true, render `EmptyState` with the `AlertTriangle` icon, the title "Couldn’t load the dashboard", the description "Check your connection and try again.", and a "Try again" button (`min-h-11`, the classes from `transactions/page.tsx:776-779`) calling `refetch()`. This replaces the `: null` branch.

- [ ] **Step 2: Add a CHANGELOG entry** for the three widgets, the badges and the error state.

- [ ] **Step 3: Run the full verification**

Run: `pnpm lint`, then `pnpm type-check`, then `pnpm test`.
Expected: all pass, with 0 warnings.

- [ ] **Step 4: Check by hand in `pnpm dev`, at 375px and at desktop width**

- Recent rows show the card name, Photo and source icons.
- Every category row opens `/transactions` with a total equal to the row's amount.
- Step the month back, and a category link carries the previous month's `from`/`to`.
- Tap a trend month, then open the footer link, and the list total matches.
- Turn hide-amounts on, and no amount appears in the tooltips, axis, footer, donut or rows.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx" CHANGELOG.md
git commit -m "feat(dashboard): show a retry state when the dashboard fails to load"
```
