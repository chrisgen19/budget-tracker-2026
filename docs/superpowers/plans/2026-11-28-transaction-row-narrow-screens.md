# Transaction Row on Narrow Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each transaction row readable at 360 to 430px wide (option A, "Tidy two lines"), and stop the type toggle from clipping.

**Architecture:** The row moves out of `transactions/page.tsx` into `TransactionListRow`. Phone vs desktop is decided in CSS (`sm:`), never in JS, so server and client render the same thing. Select mode is page state: `selectMode || selectedItems.length > 0`.

**Tech Stack:** Next.js 15, React, Tailwind, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-28-transaction-row-narrow-screens-design.md`

## Global Constraints

- Touch targets at least 44x44px.
- No new packages.
- `formatPeriodLabel(type, from, to)` with no 4th argument returns exactly what it does today.
- Desktop (`sm` and up) layout unchanged: checkbox column, text badges, up to 3 pills.

## Review Focus

- Scrolling the list on a phone must never enter select mode (long-press cancels on more than 10px of movement). Test in Task 4.
- The click that ends a long-press must not also open the edit modal or toggle the row back. Test in Task 4.
- Leaving select mode with nothing selected: the "Done" button in the date header exits. Test in Task 5.
- A row with 0 labels shows no stray "·". Test in Task 3.
- Hide-amounts still masks the amount in the extracted row. Test in Task 5.

---

### Task 1: Short month label in the dense period picker

**Files:** Modify `src/lib/analytics-period.ts`, `src/components/ui/period-picker.tsx`. Test: `src/lib/analytics-period.test.ts`.

**Interfaces:** Produces `formatPeriodLabel(type, from, to, options?: { monthStyle?: "full" | "short" }): string`.

- [ ] Test: `formatPeriodLabel("monthly", "2026-11-01", "2026-11-30", { monthStyle: "short" })` is `"Nov 2026"`. A custom range covering a whole month gives the same. Without options it is still `"November 2026"`.
- [ ] Implement. In `PeriodPicker`, when `dense` and no `label` prop, the visible span uses the short form. `aria-label` keeps `resolvedLabel`.
- [ ] Run `pnpm test src/lib/analytics-period.test.ts`: PASS.

### Task 2: Icon variant for row badges

**Files:** Modify `src/components/transactions/transaction-row-badges.tsx`. Test: its `.test.tsx`.

**Interfaces:** Produces the prop `variant?: "chip" | "icon"` (default `"chip"`, today's output).

- [ ] Test: with `variant="icon"`, `receiptPhotoId` gives a `role="img"` named "Photo attached", `receiptGroupId` "Itemized receipt", `billId` "Bill payment", and a card "Paid with BPI Gold". No visible "Photo" text.
- [ ] Implement: same conditions, 12px glyphs, `role="img"` plus `aria-label` and `title`. Provenance icons are unchanged.
- [ ] Run the badge tests: PASS.

### Task 3: Phone-aware label pills

**Files:** Modify `src/components/transactions/transaction-label-pills.tsx`. Test: create `transaction-label-pills.test.tsx`.

- [ ] Test, with 3 labels and `maxVisible={3}`:
  - pills 2 and 3 carry `hidden sm:inline-flex`;
  - a "+2" counter is `sm:hidden`;
  - with 4 labels, a desktop "+1" is `hidden sm:inline`;
  - the first pill's name sits in a `truncate` span.
- [ ] Test: with 0 labels it renders nothing.
- [ ] Implement:
  - The first pill gets `min-w-10 max-w-[55%] shrink sm:max-w-none sm:shrink-0`.
  - The name sits in `<span className="truncate">`, so the remove X stays visible.
  - The phone counter is `+(n-1)`; the desktop counter is `+(n-maxVisible)`.
- [ ] Run the tests: PASS.

### Task 4: `useLongPress` hook

**Files:** Create `src/hooks/use-long-press.ts` and `.test.ts`.

**Interfaces:** Produces `useLongPress(onLongPress: () => void, options?: { delayMs?: number; moveTolerancePx?: number }): { handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave }, consumeClick: () => boolean }`. The defaults are 450ms and 10px. `consumeClick()` returns true once, right after a long-press fired, so the row's onClick can bail.

- [ ] Tests (fake timers):
  - a touch held for 450ms fires;
  - a release at 300ms does not;
  - moving 11px before 450ms cancels;
  - `pointerType: "mouse"` never fires;
  - `consumeClick()` is true once after firing, then false.
- [ ] Implement. Call `navigator.vibrate?.(10)` on fire.
- [ ] Run the tests: PASS.

### Task 5: `TransactionListRow` and select mode

**Files:** Create `src/components/transactions/transaction-list-row.tsx` and `.test.tsx`. Modify `src/app/(app)/transactions/page.tsx`.

**Interfaces:** Consumes Tasks 2 to 4. Produces `TransactionListRow` with these props:
- `tx`, `isSelected`, `selectMode`, `highlighted`, `hideAmounts`, `currency`, `timezoneOffset`;
- `creditCardsEnabled`, `receiptPhotosEnabled`;
- `onToggle()`, `onOpen()`, `onLongPress()`;
- `labelRemoval: { onRemove, removingLabelId, disabled }`.

- [ ] Tests:
  - when `selectMode` is false, the checkbox wrapper has `hidden sm:inline-flex`, and a click calls `onOpen`;
  - when `selectMode` is true, the checkbox is visible and a click calls `onToggle`;
  - when `hideAmounts` is on, the row shows "••••";
  - a badge renders twice: as a chip in the `hidden sm:contents` wrapper and as an icon in the `contents sm:hidden` wrapper.
- [ ] Implement the row:
  - padding `px-4 sm:px-5`;
  - on phones, `select-none [-webkit-touch-callout:none]`;
  - the category span is `truncate` with `min-w-0`;
  - the date header also moves to `px-4 sm:px-5`.
- [ ] Wire it into the page:
  - add `const [selectMode, setSelectMode] = useState(false)` and `inSelectMode = selectMode || selectedItems.length > 0`;
  - long-press calls `setSelectMode(true)` and selects the row when it is not already selected;
  - each date header gets a `sm:hidden` button with a 44px target, reading "Select" or "Done"; it toggles `selectMode` and clears the selection on Done;
  - `clearSelection`, Escape and the filter-change effect all set `selectMode` to false.
- [ ] Run `pnpm lint`, `pnpm type-check` and `pnpm test`: all PASS.
- [ ] Check by hand in a browser at 360, 390 and 440 wide, and at desktop width.
- [ ] Commit: `feat(transactions): fit rows and type toggle on narrow phones`.
