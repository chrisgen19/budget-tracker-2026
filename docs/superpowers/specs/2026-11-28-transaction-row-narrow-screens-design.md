# Transaction row on narrow screens

## Why

On an Android phone the transactions list showed much less than on an iPhone: titles cut after a
few letters, the category shrunk to a lone "·", label pills cut mid-word, and the "−" of the
All / + / − toggle cut off at the card edge.

The cause is width, not font size. The Android phone lays the page out at about 390 CSS px, the
iPhone (Pro Max) at 440. Text and icons are the same size in CSS px on both; Android simply
scales a narrower page up. Each row spends about 220px on things that never shrink (padding, a
44px checkbox target, the icon, gaps, the amount), so the description column drops from about
184px to about 133px, a 28% loss taken entirely by the text.

## Goals

- At 360 to 430px wide, a row shows its title, its category and its first label legibly.
- The category can never collapse to nothing; a long label shortens instead.
- The type toggle fits beside the period picker at 390px without being clipped.
- Desktop (`sm` and up) keeps today's layout: checkbox column, text badges, up to 3 label pills.

## Non-goals

- Titles do not wrap (picked: single line with ellipsis).
- No change to the bulk action bar, selection model, or what can be bulk-edited.
- No change to the row's data or API.

## Approaches considered

Shown as clickable mockups (375px phone and desktop each) in the visual companion.

- **A. Tidy two lines (picked).** Same two-line row. Category and the first label share the meta
  line, the label is capped at about half the line and truncates, extra labels collapse into
  "+N". Rows keep one even height.
- **B. Labels on their own line.** Labels wrap on a third line, time moves beside the category.
  Every label is readable in full, but rows are taller and fewer fit on screen.
- **C. Label dots.** Labels become coloured dots on phones. Most room for the category, but a
  label is only identifiable by colour.

A was picked: it recovers the most space while changing the least about how the list reads.

## Design (below `sm`, that is phones)

1. **Checkbox appears only in select mode.** Select mode starts with a long-press on a row
   (touch or pen, about 450ms, cancelled by moving more than 10px so scrolling never selects),
   which also selects that row, or with a "Select" button in each date header. While in select
   mode a row tap toggles it, the checkbox column shows, and the date-header button reads
   "Done" and leaves select mode. Clearing the selection (the bulk bar's clear, Escape, a filter
   change) also leaves it. At `sm` and up the checkbox is always shown and nothing changes.
2. **Badges move to the meta line as icons.** Photo, Itemized, Bill, the card, and the
   provenance markers render as 12px icons at the start of the category line, each with an
   accessible name (the card's name for the card). The text chips stay beside the title at `sm`.
3. **Meta line shares space.** The category truncates instead of being squeezed to zero. Only
   the first label pill shows, capped at 55% of the line and truncating its name; further labels
   show as "+N". At `sm` up to 3 full pills show as today.
4. **Row padding** goes from 20px to 16px each side on phones (date headers too, so they align).
5. **Type toggle clip.** The rail's period picker shows a short month ("Nov 2026") instead of
   "November 2026" in its dense form. Its accessible name keeps the full label. This makes picker
   plus toggle fit at 390px without breaking the 44px touch target rule.

## Constraints

- Touch targets stay at least 44x44px (AGENTS.md "Design").
- No new packages.
- `formatPeriodLabel` is also used by API routes: its existing output must not change.

## Left to the builder

- Exact markup and how the row is split out of `transactions/page.tsx` (it is 1094 lines).
- Haptic feedback on long-press, where `navigator.vibrate` exists.
