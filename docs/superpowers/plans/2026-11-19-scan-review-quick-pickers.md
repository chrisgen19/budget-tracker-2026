# Scan Review Quick Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-tap category and label chips on each receipt in Review Scanned Receipts, with a "More" chip opening a searchable picker inside the same sheet.

**Architecture:** Extract the quick-label ordering from `LabelPicker` into a pure lib function both pickers share. Two new components in `src/components/scan-review/` (chip rows for one receipt, full search picker view). `MultiScanReview` renders the chips per card, swaps to the picker view on More, and reports changes through a new `onUpdate` prop wired to `scan.updateItem`.

**Tech Stack:** Next.js 15, React, TanStack Query hooks, Tailwind, Lucide, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-11-19-scan-review-quick-pickers-design.md`

## Global Constraints
- `labelIds` is written only when the user touches a label chip; untouched receipts keep `undefined`.
- Chips disabled when `isSaving || unconfirmedIds.has(item.id)`.
- Touch targets: 44px hit area (pseudo-element pattern from AGENTS.md Design).
- No new packages, no API change. Named exports, `function` components, kebab-case files.
- `pnpm lint`, `pnpm type-check`, `pnpm test` pass.

## Review Focus
- Receipt with `type: "INCOME"`: category chips list income categories only; labels filtered by `applicableTo`.
- Current category not among the quick four: it still shows first and selected.
- Untouched receipt with a matching schedule: scheduled label shows selected with clock; first toggle of another label keeps it.
- Categories or labels query loading or failed: chip rows show a shimmer or nothing, the card still works via pencil.
- Search with no matches in the picker: an empty message, not a blank panel.

---

### Task 1: Extract `resolveQuickLabels`

**Files:**
- Create: `src/lib/quick-labels.ts`, `src/lib/quick-labels.test.ts`
- Modify: `src/components/transactions/label-picker.tsx` (replace the inline `quickLabels` memo, `isCompatible`, `byName`, `byUsageThenName` with imports)

**Interfaces:**
- Produces: `isLabelCompatible(label, type?)`, `byLabelName(a, b)`, `resolveQuickLabels<T extends LabelWithCountAndSchedules>(labels: T[], pinnedIds: string[], type?: "INCOME" | "EXPENSE", categoryId?: string): T[]`, `QUICK_LABEL_COUNT = 4`.

- [ ] Test: pins first in pin order; backfill by category count, then total count, then name; capped at `max(4, pins.length)`; incompatible labels excluded.
- [ ] Run `pnpm vitest run src/lib/quick-labels.test.ts`: FAIL (module missing).
- [ ] Implement by moving the existing code verbatim (comments included).
- [ ] Run the new test and `src/components/transactions/label-picker.test.tsx`: PASS.
- [ ] Commit `refactor(labels): share quick-label ordering`.

### Task 2: `ScanQuickChips` (chip rows for one receipt)

**Files:**
- Create: `src/components/scan-review/scan-quick-chips.tsx`, `src/components/scan-review/scan-quick-chips.test.tsx`

**Interfaces:**
- Consumes: `resolveQuickLabels`, `resolveQuickCategories`, `useCategoriesQuery(type)`, `useQuickPreferencesQuery`, `useLabelsQuery`, `useQuickLabelsQuery`, `useScheduledLabel`.
- Produces: `ScanQuickChips({ item: MultiScanItem, disabled: boolean, onUpdate(id, patch: { categoryId?: string; labelIds?: string[] }), onMore(kind: "category" | "labels") })` and exported helper `effectiveLabelIds(labelIds: string[] | undefined, scheduledLabelId: string | null): string[]`.

- [ ] Tests: tapping a category chip calls `onUpdate(id, { categoryId })`; current non-quick category renders first with `aria-pressed="true"`; untouched receipt with a schedule shows that label pressed, and toggling another sends both ids; toggling with `labelIds: []` sends `[id]`; `disabled` disables every chip; More chips call `onMore`.
- [ ] Run: FAIL. Implement. Run: PASS.
- [ ] Commit `feat(scan): add quick category and label chips to scan review`.

### Task 3: `ScanFullPicker` (More view)

**Files:**
- Create: `src/components/scan-review/scan-full-picker.tsx`, `src/components/scan-review/scan-full-picker.test.tsx`

**Interfaces:**
- Produces: `ScanFullPicker({ item, kind: "category" | "labels", onUpdate, onClose })`. Category: search + 3-col grid of the type's categories, picking calls `onUpdate` then `onClose`. Labels: search + checklist of compatible labels (plus already-selected incompatible ones), toggle calls `onUpdate` with the full list, "Done" calls `onClose`.

- [ ] Tests: search filters by name, case-insensitive; no match shows `No categories match` / `No labels match`; category pick calls both callbacks; label toggle seeds from the scheduled label like Task 2.
- [ ] Run: FAIL. Implement. Run: PASS.
- [ ] Commit `feat(scan): add searchable picker for scan review chips`.

### Task 4: Wire into review

**Files:**
- Modify: `src/components/multi-scan-review.tsx` (new `onUpdate` prop; render `ScanQuickChips` in success cards; `picker` state `{ itemId, kind } | null` swaps list and footer for `ScanFullPicker`)
- Modify: `src/components/app-shell.tsx:369` (pass `onUpdate={scan.updateItem}`)
- Modify: `CHANGELOG.md`

- [ ] `pnpm lint && pnpm type-check && pnpm test`: all pass.
- [ ] Check the review at 375px and desktop in the dev server (or say it was not checked).
- [ ] Commit `feat(scan): pick category and labels straight from the receipt review`.
