---
name: finance-assess
description: Run a full financial assessment of the budget tracker data — savings rate, runway, bill accuracy, category trends, subscription creep, duplicates, and data-quality problems. Use when the user asks to assess/review/analyze their finances, spending, or budget, or types `/finance-assess`.
---

You are producing a financial assessment from the budget tracker's own database.

## Approach

Two sources, each for what it is actually good at:

- **`scripts/assess.sql` against the local database** does the pattern work — trends,
  variance, recurrence, duplicates, data quality. One `psql` call returns every section,
  which is far cheaper than improvising a dozen queries and re-deriving the timezone
  logic each time.
- **The `budget` MCP tools** supply live, authoritative figures for anything
  forward-looking or current: `get_budget_overview` and `get_upcoming_bills`.

Prefer MCP for "right now", the script for "what has been happening". The local database
is a **mirror** and drifts as soon as the app is used again — the script prints
`newest_row` so you can see how stale it is. If `newest_row` is more than a couple of days
behind, say so rather than reporting the current month as fact.

Never hand-write aggregate SQL over `transaction_labels` or bill dates unless the script
has no answer. A transaction can carry several labels and its amount splits evenly between
them, so a naive join double-counts; bill due dates are date-only at UTC midnight and must
not be timezone-shifted. That logic already lives in `src/lib/budget-queries.ts`.

## Steps

1. **Run the script.** From the repo root:

   ```bash
   set -a; . ./.env; set +a
   psql "$DATABASE_URL" -q -f .claude/skills/finance-assess/scripts/assess.sql
   ```

   Optional: `-v email=someone@example.com` to pick a user (defaults to whoever has the
   most transactions), `-v months=12` to widen the window (defaults to 6).

2. **Read section 1 before anything else.** Months marked `EXCLUDED - low coverage` are
   months where logging stopped, not cheap months. Say which months were dropped and why —
   a user who sees a low month in their app deserves to know it is a gap, not a win.

   The gate applies to every **rate, average and trend**: sections 2, 4, 7 and 8 read only
   trustworthy months. It deliberately does **not** apply to the sections that detect
   whether something *exists* — recurring spend (5), duplicates (6) and fragmentation (9)
   read the whole window. An excluded month is missing rows, not wrong ones: a duplicate
   submitted in it is still a duplicate, a misspelling is still a misspelling, and hiding
   them would suppress real findings while filtering recurrence would only understate it.
   Section 3 reads a bill's whole payment history, since a bill is judged against every
   payment it ever took.

3. **Pull live figures from MCP** for the current month and upcoming bills. Cross-check the
   bill amounts against section 3's `avg_paid`.

4. **Write the assessment** in the terminal, following the rules below.

5. **Publish the report page.** Every run ends with the artifact updated — it is part of
   the deliverable, not an optional extra. Copy `templates/report.html` into the scratchpad
   and edit two things:

   - **The `REPORT` block** at the top of the `<script>` — the bill series with its
     budgeted amount, and the cash-flow months with their coverage. That is the *only*
     numeric edit: the renderer below it computes every bar, gridline, tick and label
     from those figures. Never hand-write chart geometry, and never edit the renderer.
   - **The prose** — headline, ledger figures, the row stacks, the spellings, the action
     block, the scope row in the masthead. This is the judgement half and gets rewritten
     each run.

   Then publish it to the **same URL**, so there is one link that always holds the current
   assessment rather than a new artifact each month:

   ```
   https://claude.ai/code/artifact/b0780155-aeab-44e9-8d84-88b5ac03f854
   ```

   Pass that as `url` (with `action: "read"` first, per the Artifact tool's update flow).
   Publish a *separate* artifact only if the user asks to keep a run for comparison.

   Three things about the template that are settled and should not be relitigated:

   - **Non-ASCII inside the `<script>` must be `\uXXXX`-escaped**, never a literal glyph.
     A raw `₱` renders as `â‚±` wherever the file is decoded as anything but UTF-8. The
     markup uses HTML entities for the same reason.
   - **The series colours are validated, not chosen by eye.** `#1B6B5A`/`#D2601A` in light
     and `#35A088`/`#D9772B` in dark pass all six checks of the `dataviz` validator against
     their own surfaces. The app's own green/red pair fails colourblind separation at
     ΔE 5.0 (deutan), which is why these are not the app's colours. Re-run the validator
     before changing either.
   - **The `<title>` stays "The Trustworthy Months".** It names the artifact in the gallery,
     so it holds across runs and carries no figure that could go stale.

## What each section is for

| Section | What to look for |
|---|---|
| 1. Data confidence | Excluded months, logging gaps of 4+ days |
| 2. Headline | Savings rate, monthly burn, months of runway |
| 3. Bill accuracy | **Read `swing` before `variance_pct`.** Swing under ~1.5 means a fixed bill, and a high variance there really is a misconfigured figure. A bill in the *second* table is a metered one — high swing **and** a budget inside the range actually paid — where no single figure can be right and the month-by-month shape is shown. High swing alone is not enough: a bill nobody budgeted anywhere near still needs its warning. Also bills paid *outside* the bill system, which silently skip the schedule |
| 4. Category trend | Rising categories only; a fall is usually the gap, not thrift |
| 5. Recurring spend | The fixed monthly base, and **new** recurring charges — habits forming before they are noticed |
| 6. Duplicates | Same day, description and amount — usually a double-submit |
| 7. Income concentration | Share from the single largest source |
| 8. Unlabeled spend | Split by cause. `bill payment (auto-created)` is a **system gap** — bill payments bypass label auto-apply — not user sloppiness. Say which it is |
| 9. Fragmentation | One thing stored several ways. Matters because the Telegram bot searches by description text |

## Writing rules

- **Lead with the single most consequential finding**, not with the headline table. If a
  bill is 60% under-budgeted, that goes first; the savings rate can wait a paragraph.
- **Separate accuracy problems from money problems.** "Your July spending fell" is wrong
  when July is a logging gap. Most findings here are about the numbers being wrong, and
  saying so is more useful than inventing frugality advice.
- **Give credit where the numbers earn it.** A 30%+ savings rate with every month
  net-positive is a good result; say so plainly and move on to what needs attention.
- **Attribute causes honestly.** Unlabeled bill payments are the app's behavior, not the
  user's. Do not turn a system gap into a lecture about discipline.
- **A bill in section 3's second table is not a misconfigured one.** That table requires two
  things — payments swinging 2x or more, *and* the budgeted figure falling between the lowest
  and highest actually paid, so it is right for part of the year. A bill with a high swing
  whose budget sits outside that range (100 budgeted, 300-600 paid) is simply wrong and its
  variance warning stands. Only the listed ones get this exception; for those, do not report
  "X% over budget" as though a better constant existed. The monthly
  series will usually show a season, and the budgeted figure is often exactly right for part
  of the year. Say which months run high, say what the *next* due date is likely to cost,
  and point at issue #217 rather than recommending a number — an annual average makes the
  near-term forecast worse, which is the opposite of the fix. Where the shape has an obvious
  cause, ask rather than assert: one summer of data is one observation, not a pattern.
- **Never present the current month as a trend** — it is partial by definition.
- Format money in the user's own currency (the script reports it) with thousands
  separators. Round to whole units; centavo precision is noise at this altitude.
- **End with one action worth doing this week** — the highest-leverage, smallest-effort
  item. One, not a list.
- The terminal answer and the published page carry the **same** findings and the same
  figures. The page is not a summary of the assessment, it is the assessment — hand over
  its link at the end rather than describing what is on it.

## Extending

Add a section by appending a `\qecho` header plus one query to `assess.sql`. Keep the
`ld` local-time view rather than raw `date`, keep it read-only, and keep output narrow —
this report is read by a model before a human, and wide result sets cost tokens without
adding insight.
