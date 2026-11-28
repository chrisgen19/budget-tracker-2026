# Category Chips Above the Keyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a phone, while the amount field is focused and the keyboard is open, replace the
Cancel / Add Transaction footer with a row of category chips flush on top of the keyboard.

**Architecture:** `Modal` already knows when the keyboard is open (`useVisualViewport`) and sizes
the sheet so its bottom edge is the keyboard's top. It will publish `keyboardOpen` plus a
**footer slot** element (an empty `shrink-0` div after the scroll area) through a React context.
`TransactionForm` portals a new `CategoryChipStrip` into that slot while the amount input is
focused, and hides its own sticky footer in exactly that state. Outside the slot the strip cannot
sit in the padded scroll area, so the sticky-padding gap cannot recur.

**Tech Stack:** Next.js 15, React 19, Tailwind, Framer Motion (already used), Vitest + RTL (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-28-amount-keyboard-category-chips-design.md`

## Global Constraints

- No new packages. `createPortal` from `react-dom` is already used by `modal.tsx`.
- Touch targets at least 44x44px (AGENTS.md Design rule): each chip is `min-h-11`.
- Desktop (width >= 640px, `useIsMobile` false) behaves exactly as today.
- Outside a `Modal`, the form behaves exactly as today (context default is closed, no slot).
- Copy: the overflow chip reads `More…`; chips show the category name.
- No em or en dashes in new comments, docs or commit messages.
- Branch `feature/amount-category-chips`. Conventional Commits.
- Before calling it done: `pnpm lint`, `pnpm type-check`, `pnpm test` all green.

## Review Focus

1. **Switching Expense/Income while the strip shows:** chips must follow the new type (the quick
   list is per type). Pinned in Task 3, `follows the transaction type`.
2. **Chip tap while the keyboard is closing:** the tap must not be lost to a layout shift. The chip
   cancels `pointerdown` so focus (and the keyboard) stays until the pick lands. Pinned in Task 2,
   `keeps focus on pointerdown`.
3. **Context says keyboard open but the slot is not mounted yet** (first commit): no crash, the
   footer stays visible, no strip. Pinned in Task 3, `keeps the footer when there is no slot`.
4. **Categories still loading or the quick list empty:** no empty strip; footer stays. Pinned in
   Task 3, `keeps the footer while categories load`.
5. **Editing a row:** its category chip shows as selected. Pinned in Task 2, `marks the selected
   chip` (the form passes `watchedCategoryId`).

---

### Task 1: Modal publishes keyboard state and a footer slot

**Files:**
- Create: `src/components/ui/modal-keyboard-context.ts`
- Modify: `src/components/ui/modal.tsx` (`Modal`, around lines 268-400)
- Test: `src/components/ui/modal.keyboard.test.tsx` (new `describe` block, reuse its
  `FakeVisualViewport` and `matchMedia` setup)

**Interfaces:**
- Produces:
  ```ts
  export interface ModalKeyboardState {
    /** Mobile sheet with the on-screen keyboard up. Always false on desktop and outside a Modal. */
    keyboardOpen: boolean;
    /** Element flush with the sheet's bottom edge (the keyboard's top while it is open), or null. */
    footerSlot: HTMLElement | null;
  }
  export const ModalKeyboardContext: React.Context<ModalKeyboardState>; // default { keyboardOpen: false, footerSlot: null }
  export const useModalKeyboard: () => ModalKeyboardState;
  ```

- [ ] **Step 1: Write the failing tests** in `modal.keyboard.test.tsx`, a new
  `describe("Modal keyboard context", ...)` using a probe child:
  ```tsx
  function Probe() {
    const { keyboardOpen, footerSlot } = useModalKeyboard();
    return <p data-testid="probe">{`${keyboardOpen}:${footerSlot ? "slot" : "none"}`}</p>;
  }
  ```
  - `reports the keyboard closed, with a slot, when the sheet opens`: render
    `<Modal open title="T" onClose={() => {}}><Probe /></Modal>` at mobile width; expect
    `probe` text `false:slot`.
  - `reports the keyboard open once the visual viewport shrinks`: then
    `viewport.shrinkTo(360)`; expect `true:slot`.
  - `reports closed outside a Modal`: render `<Probe />` alone; expect `false:none`.
  - `places the slot after the scroll area`: the slot element is the dialog's last child and
    `contentRef`'s scroll div is its previous sibling (query `[role="dialog"]`, assert
    `lastElementChild` has `data-modal-footer-slot`).

- [ ] **Step 2: Run to verify they fail**
  Run: `pnpm exec vitest run src/components/ui/modal.keyboard.test.tsx`
  Expected: FAIL, `useModalKeyboard` not exported / module not found.

- [ ] **Step 3: Implement**
  - `modal-keyboard-context.ts`: `"use client"`, the interface, context with the default above,
    `useModalKeyboard = () => useContext(ModalKeyboardContext)`.
  - `modal.tsx`: `const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null)`;
    after the scroll div render `<div ref={setFooterSlot} data-modal-footer-slot className="shrink-0" />`;
    wrap `children` (inside the scroll div) in
    `<ModalKeyboardContext.Provider value={keyboardState}>` where `keyboardState` is
    `useMemo(() => ({ keyboardOpen: isMobile && !!viewport?.keyboardOpen, footerSlot }), [...])`.
    An empty slot has zero height, so nothing changes visually for any other modal.

- [ ] **Step 4: Run to verify they pass**, plus the existing modal suites
  Run: `pnpm exec vitest run src/components/ui/modal.keyboard.test.tsx src/components/ui/modal.test.tsx`
  Expected: PASS, no regressions.

- [ ] **Step 5: Commit**
  ```bash
  git add src/components/ui/modal-keyboard-context.ts src/components/ui/modal.tsx src/components/ui/modal.keyboard.test.tsx
  git commit -m "feat(modal): expose keyboard state and a footer slot to sheet content"
  ```

### Task 2: CategoryChipStrip component

**Files:**
- Create: `src/components/transactions/category-chip-strip.tsx`
- Test: `src/components/transactions/category-chip-strip.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface ChipCategory { id: string; name: string; icon: string; color: string }
  export function CategoryChipStrip(props: {
    categories: ChipCategory[];   // already resolved quick categories, in display order
    selectedId: string;            // "" when none
    showMore: boolean;             // render the trailing "More…" chip
    onPick: (id: string) => void;
    onMore: () => void;
  }): JSX.Element
  ```
- Look: matches mockup C. Container `flex gap-2 overflow-x-auto px-3 py-2 bg-cream-50 border-t
  border-cream-200` with `role="toolbar"` and `aria-label="Pick a category"`. Each chip a
  `type="button"` pill: `min-h-11 shrink-0 rounded-full bg-white border border-cream-200 px-3
  text-sm text-warm-600 inline-flex items-center gap-1.5`, `CategoryIcon` at `w-4 h-4` in
  `cat.color`. Selected chip: `bg-amber-light ring-2 ring-amber/40` and `aria-pressed="true"`.

- [ ] **Step 1: Write the failing tests**
  - `renders one chip per category in order, then More…` (names in order; last button `More…`).
  - `hides More… when showMore is false`.
  - `marks the selected chip` (`aria-pressed` true on the selected id only).
  - `calls onPick with the id` / `calls onMore` on click.
  - `keeps focus on pointerdown`: `fireEvent.pointerDown(chip)` returns `false`
    (default prevented), for a category chip and for `More…`.

- [ ] **Step 2: Run to verify they fail**
  Run: `pnpm exec vitest run src/components/transactions/category-chip-strip.test.tsx`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement** per the interface; every chip's `onPointerDown` calls
  `e.preventDefault()` so the focused amount input keeps focus until the click handler runs.

- [ ] **Step 4: Run to verify they pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add src/components/transactions/category-chip-strip.tsx src/components/transactions/category-chip-strip.test.tsx
  git commit -m "feat(transactions): add a category chip strip for the keyboard edge"
  ```

### Task 3: Wire the strip into TransactionForm

**Files:**
- Modify: `src/components/transactions/transaction-form.tsx` (amount input ~line 451, footer ~line 651)
- Test: `src/components/transactions/transaction-form.chips.test.tsx` (new; copy the module mocks
  from `transaction-form.test.tsx`, as `transaction-form.paid-with.test.tsx` does, and give the
  EXPENSE list two categories, `food` and `transport`, plus INCOME `salary`)

**Interfaces:**
- Consumes: `useModalKeyboard()` (Task 1), `CategoryChipStrip` (Task 2), existing
  `quickCategories`, `categories`, `MAX_QUICK_CATEGORIES`, `setShowCategoryPicker`, `setValue`.

- [ ] **Step 1: Write the failing tests.** Render helper wraps the form in
  `<ModalKeyboardContext.Provider value={{ keyboardOpen, footerSlot: slotEl }}>` where `slotEl`
  is a `div` appended to `document.body`; assert inside it with `within(slotEl)`.
  - `shows chips and hides the footer while the amount is focused with the keyboard open`:
    focus the amount (`placeholder "0.00"`), expect `toolbar "Pick a category"` in the slot and
    the footer hidden. jsdom applies no Tailwind CSS and jest-dom is not installed, so the
    footer gets `data-testid="form-footer"` and the assertion is
    `footer.classList.contains("hidden") === true`.
  - `picks the category and closes the keyboard on a chip tap`: type `222`, click `Food` chip;
    expect the amount input not to be `document.activeElement`, the strip gone, the footer
    without `hidden`;
    then submit and expect `onSubmit` called with `categoryId: "food"`, `amount: 222`.
  - `opens the category picker from More…` (needs more than `MAX_QUICK_CATEGORIES` categories:
    give the mock 5 EXPENSE categories for this file).
  - `follows the transaction type`: render with `initialData={{ type: "INCOME" }}`, focus the
    amount, assert a `Salary` chip and no `Food` chip.
  - `does nothing when the keyboard is closed`: `keyboardOpen: false`, focus amount, no toolbar,
    footer visible.
  - `keeps the footer when there is no slot`: `keyboardOpen: true, footerSlot: null`.
  - `keeps the footer while categories load`: mock `isLoading: true` for one test
    (`vi.mocked` override) and expect no toolbar.

- [ ] **Step 2: Run to verify they fail**
  Run: `pnpm exec vitest run src/components/transactions/transaction-form.chips.test.tsx`
  Expected: FAIL, no toolbar rendered.

- [ ] **Step 3: Implement in `transaction-form.tsx`**
  - `const amountInputRef = useRef<HTMLInputElement>(null)`, `const [amountFocused, setAmountFocused] = useState(false)`;
    on the amount input add `ref`, `onFocus={() => setAmountFocused(true)}`, and set it false
    inside the existing `onBlur` (keep its formatting logic).
  - `const { keyboardOpen, footerSlot } = useModalKeyboard();`
    `const showChips = keyboardOpen && amountFocused && !!footerSlot && !loadingCategories && quickCategories.length > 0;`
    (the strip renders only in the form view, so `showCategoryPicker` already excludes it).
  - Render `{showChips && footerSlot && createPortal(<CategoryChipStrip ... />, footerSlot)}` inside
    the form view, with `categories={quickCategories}`, `selectedId={watchedCategoryId}`,
    `showMore={categories.length > MAX_QUICK_CATEGORIES}`,
    `onPick={(id) => { setValue("categoryId", id, { shouldValidate: true }); amountInputRef.current?.blur(); }}`,
    `onMore={() => { amountInputRef.current?.blur(); setShowCategoryPicker(true); }}`.
  - Footer div: add `data-testid="form-footer"`, and `hidden` when `showChips`. Keep it mounted so form state and the submit
    button are untouched.
  - If the form exceeds lint limits, the extracted pieces go in `category-chip-strip.tsx`, not a
    new file.

- [ ] **Step 4: Run to verify they pass**, plus the other form suites
  Run: `pnpm exec vitest run src/components/transactions/`
  Expected: PASS, no regressions in `transaction-form*.test.tsx`.

- [ ] **Step 5: Commit**
  ```bash
  git add src/components/transactions/transaction-form.tsx src/components/transactions/transaction-form.chips.test.tsx
  git commit -m "feat(transactions): pin category chips above the keyboard while typing the amount"
  ```

### Task 4: Docs, full checks, device check

**Files:**
- Modify: `CHANGELOG.md` (new top entry `## 2026-11-28 - Category chips above the keyboard`,
  three short bullets in the existing style: what shows when, what a tap does, footer unchanged elsewhere)
- Modify: `AGENTS.md` Key Patterns, the **Modal** bullet: one sentence that `Modal` publishes
  `useModalKeyboard()` (`keyboardOpen`, `footerSlot`) from `modal-keyboard-context.ts`, and that
  content portalled into `footerSlot` sits flush on the keyboard.
- Add the spec and this plan to the commit.

- [ ] **Step 1: Write the docs** as above.
- [ ] **Step 2: Run the full gate**
  Run: `pnpm lint` then `pnpm type-check` then `pnpm test`
  Expected: all exit 0, `--max-warnings 0` clean.
- [ ] **Step 3: Browser check at 375px** (chrome-devtools device emulation, `pnpm dev`): the strip
  cannot appear without a real keyboard, so confirm only that desktop and mobile without focus
  look unchanged, and screenshot. Say plainly that the keyboard state was not exercised here.
- [ ] **Step 4: Hand the device check to the user**: Android Chrome (the reported phone) and iOS
  Safari. Open New Transaction, type an amount: chips flush on the keyboard, no gap; tap a chip:
  category set, keyboard down, footer back; tap `More…`: picker opens; switch to Income: chips change.
- [ ] **Step 5: Commit**
  ```bash
  git add CHANGELOG.md AGENTS.md docs/superpowers/specs/2026-11-28-amount-keyboard-category-chips-design.md docs/superpowers/plans/2026-11-28-amount-keyboard-category-chips.md
  git commit -m "docs: record the category chip strip and the modal keyboard context"
  ```
