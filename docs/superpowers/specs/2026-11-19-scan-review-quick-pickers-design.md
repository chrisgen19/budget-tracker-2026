# Scan review quick pickers

## Intent
In **Review Scanned Receipts**, changing a scanned receipt's category or labels currently means
pencil, then the full Edit Transaction form, then back. Category and labels are the two things most
often corrected (both matter equally), and a scan usually yields 1-2 receipts. Make both a single
tap from the review list.

## Goals
- Category: one tap on a chip row under each receipt.
- Labels: one tap to toggle a chip under each receipt.
- Anything not on the chip rows: a "More" chip opens a searchable picker without leaving the review.

## Non-goals
- No bulk "apply to all receipts" (batches are usually 1-2).
- Amount, date, description, type and Paid with stay in the pencil (full edit), unchanged.
- No API or schema change.

## Anti-goals
- Touching the label chips must be the only thing that writes `labelIds`. A receipt whose labels
  were never touched keeps `labelIds: undefined` so the server's schedule auto-labelling still runs.
- Editing a row frozen as unconfirmed must stay impossible (`updateItem` already refuses it; the
  chips are also disabled).

## Approaches considered
- **A: always-on chip rows** (chosen): fastest, everything visible, cards get ~90px taller.
- **B: tappable pills with a popover picker**: most compact, one extra tap every time.
- **C: expand-to-fix card**: familiar tiles, but only one card is fixable at a glance.

Picked: **A, with B's search picker behind the More chip** (user's choice, 2026-11-19).

## Design
- Each successful receipt card gains two horizontally scrolling chip rows:
  - **Category:** the current category first (when it is not one of the quick four), then the
    user's quick categories for the receipt's type (`resolveQuickCategories`), then **More**.
    Tapping a chip writes `categoryId` through `onUpdate`.
  - **Labels:** the same quick labels the Edit form shows (pins first, then usage in this
    category, then overall), via a quick-label resolver extracted from `LabelPicker` so the two
    cannot drift. Then **More**. Toggling writes the full explicit `labelIds` list.
- While `labelIds` is undefined, the label the schedule would apply (`getScheduledLabelId` for the
  receipt's date) shows selected with a clock icon. The first touch seeds the explicit list from
  what is shown, so the schedule's pick is not silently lost.
- **More** swaps the review list for a picker view inside the same sheet (back arrow, title,
  search). Categories: grid of every category of the receipt's type; picking returns to the list.
  Labels: searchable checklist; Done returns. The save footer is hidden while the picker is open.
- Chips are 36px tall with a 44px hit area (house touch-target rule), disabled while saving or
  when the row is unconfirmed.

## Builder's calls
- Picker presentation is an in-sheet view swap (the Edit form's category picker pattern) rather
  than a floating popover: the review already sits in a Modal, and an overlay inside its scroll
  body does not stay anchored. Same content as draft B.
- New components live in `src/components/scan-review/`; `multi-scan-review.tsx` wires them, since
  it is already well over the 150-line component target.
