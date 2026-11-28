# Category chips above the keyboard on the amount step

## Why

On a phone, opening New Transaction focuses the amount and raises the keyboard. The space under
the number then goes to the sticky Cancel / Add Transaction footer (`transaction-form.tsx:651`),
and Add cannot succeed yet: `categoryId` is required (`src/lib/validations.ts:31`), and its error
renders under the category tiles, which are behind the keyboard. The footer also floats with a gap
above it, because it is sticky inside the modal's padded scroll area (`modal.tsx:396`, `p-6`).
The next thing the user actually needs is a category.

## Goals

- While the amount field is focused and the keyboard is open on mobile, show a slim row of
  category chips pinned directly above the keyboard, and hide the footer.
- One tap on a chip picks the category and closes the keyboard, so the full form (with the footer)
  is in view, ready to save.
- Close the gap: nothing floats between the amount and the keyboard.

## Non-goals

- No change on desktop (no on-screen keyboard) or while another field (description, date) is
  focused: the footer behaves as today.
- No change to validation, the quick-category preferences, or the category picker screen.

## Anti-goals

- A chip tap that misses because the keyboard closing shifted the layout under the finger.
- A footer flash, or the strip lingering, while the keyboard animates in or out.

## Approaches

- **A. Hide the footer, move the tiles up under the amount.** Least work, reuses the tiles.
- **B. Keep the footer; the main button reads "Choose category" until one is picked.** Honest,
  but still spends the space on buttons.
- **C. Chips pinned above the keyboard (picked).** Picking a category without leaving the
  number, the most native feel; the most layout work and needs Android + iOS checks.

The user picked **C** after comparing browser mockups of all three.

## Design

- **Keyboard state reaches the form through the Modal.** `Modal` already computes
  `viewport.keyboardOpen` (`useVisualViewport`, `modal.tsx:85-97`) and pins the sheet to the
  visual viewport, so the sheet's bottom edge is the keyboard's top. The Modal will expose that
  through a small context (e.g. `useModalKeyboard()`), defaulting to "closed" outside a Modal,
  so the form stays usable in any host.
- **The strip sits at the sheet's bottom edge, outside the scroll area,** so it is flush with the
  keyboard with no sticky-padding gap. Rendered by the form (it owns `setValue` and the category
  list), placed into a Modal footer slot, or a sticky element with the padding offset corrected:
  the builder picks whichever proves flush on a real Android device.
- **Shown when:** mobile, keyboard open, and the amount input is the focused element. Footer
  hidden in exactly that state; otherwise everything is as today.
- **Chips:** the type's quick categories first (same `resolveQuickCategories` order as the tiles),
  then a "More..." chip that opens the existing category picker. The row scrolls sideways. The
  selected category's chip is highlighted (matters when editing). Chips are at least 44px tall in
  hit area (house touch-target rule).
- **Tap handling:** the chip keeps the input focused on `pointerdown` (`preventDefault`), sets
  the category, then blurs the amount input itself. That orders it as pick, then keyboard close,
  so the tap cannot land on a shifted layout.
- Applies to new and edit alike; on edit the current category chip shows as selected.

## Left to the builder

- Context vs. prop for the keyboard state, and the exact slot mechanism, within the constraint
  that the strip is flush with the keyboard.
- Whether to animate the strip in/out (Framer Motion is already in use); keep it short.
- Tests: chip visibility by focus/keyboard state, a tap sets `categoryId` and blurs, footer
  hidden only in that state; extend `modal.keyboard.test.tsx` for the context value.
- Manual check on Android Chrome (the screenshots' device) and iOS Safari.
