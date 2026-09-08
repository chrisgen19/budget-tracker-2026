---
name: finance-assess
description: Run a full financial assessment of the budget tracker data — savings rate, runway, bill accuracy, category trends, subscription creep, duplicates, and data-quality problems. Use when the user asks to assess/review/analyze their finances, spending, or budget, or types `/finance-assess`.
---

You are producing a financial assessment from the budget tracker's own database.

## Approach

Two sources, each for what it is actually good at:

- **`scripts/assess.ts` against the local database** does the pattern work — coverage,
  trends, bill accuracy, recurrence, data quality, and what changed this period. One
  command returns every section, which is far cheaper than improvising a dozen queries and
  re-deriving the timezone logic each time. It prints `src/lib/assessment-facts.ts`, the
  same module the app's AI Assessment reads, so the report and the app cannot give one
  question two answers.
- **The `budget` MCP tools** supply live, authoritative figures for anything
  forward-looking or current: `get_budget_overview` and `get_upcoming_bills`.

Prefer MCP for "right now", the script for "what has been happening". The local database
is a **mirror** and drifts as soon as the app is used again — the script prints the newest
row written so you can see how stale it is. If that date is more than a couple of days
behind, say so rather than reporting the current month as fact.

MCP is also the staleness signal that survives the network being closed down (#194): it
reaches the app over HTTPS rather than opening a Postgres connection, so
`get_budget_overview` still answers when a direct connection to the source does not.
Cross-check its `runningBalance` against the script's — a divergence means the mirror is
behind, and that is how a report quoting a balance 22,000 out of date was caught.

Never hand-write aggregate SQL over `transaction_labels` or bill dates unless the script
has no answer. A transaction can carry several labels and its amount splits evenly between
them, so a naive join double-counts; bill due dates are date-only at UTC midnight and must
not be timezone-shifted. That logic already lives in `src/lib/budget-queries.ts` and
`src/lib/assessment-facts.ts`.

## Steps

0. **Ask which database to read, before running anything.**

   The local database is a *mirror*, and a stale one produces a confident report
   about figures that have moved. Use `AskUserQuestion` with these options:

   - **Refresh the mirror, then assess** — the safe default when anything has
     changed in the app since the last refresh
   - **Assess the mirror as it is** — fine when nothing has changed, and the only
     option if direct access to the source is closed (see #194)
   - **Read the source directly** — set `DATABASE_URL` to it for the one command;
     `assess.ts` is read-only, so this is safe where the network allows it

   Gather the evidence first so the question is answerable, not a guess:

   ```bash
   pnpm exec tsx --env-file=.env scripts/refresh-local-mirror.ts --from "<source url>"
   ```

   It prints both sides' transaction count and newest row without writing
   anything. **Do not treat matching counts as "fresh".** A settings change moves
   no rows: on 6 Sep both sides held identical 829 transactions while the mirror
   had `is_variable = 0` against production's `2`, so an assessment would have
   described two metered bills as fixed. Check what the question is actually
   about before answering it.

   To refresh, add `--apply`. It backs the local database up first and prints the
   command to undo, and it refuses to run unless `DATABASE_URL` is local — it
   overwrites its destination, and a reversed `--from` is the one mistake here a
   later backup cannot fix.

1. **Run the script.** Against the mirror, from the repo root:

   ```bash
   pnpm exec tsx --env-file=.env scripts/assess.ts
   ```

   Against the source instead — put the URL **on the command**. A shell variable wins over
   `--env-file`, so this really does dial the source, and nothing has to be unset afterwards:

   ```bash
   DATABASE_URL="<source url>" pnpm exec tsx --env-file=.env scripts/assess.ts
   ```

   Either way, check the `WHO / WINDOW` block the script prints: it reports the newest row
   written, and the assessment should say which database answered.

   Optional: `EMAIL=someone@example.com` to pick a user (defaults to whoever has the
   most transactions), `MONTHS=12` to widen the window (defaults to 6).

2. **Read section 1 before anything else.** Months marked `EXCLUDED - low coverage` are
   months where logging stopped, not cheap months. Say which months were dropped and why —
   a user who sees a low month in their app deserves to know it is a gap, not a win.

   The gate applies to every **rate, average and trend**: sections 2, 4, 7 and 8 read only
   trustworthy months, and so does section 6's unlabeled-spend split. It deliberately does
   **not** apply to the checks that detect whether something *exists* — recurring spend (5),
   and section 6's duplicates and fragmentation — which read the whole window. An excluded
   month is missing rows, not wrong ones: a duplicate submitted in it is still a duplicate,
   a misspelling is still a misspelling, and hiding them would suppress real findings while
   filtering recurrence would only understate it. Section 3 reads a bill's whole payment
   history, since a bill is judged against every payment it ever took.

   Note section 6 **straddles** the gate: it groups the data-quality findings by what they
   are about, not by whether the gate applies to them. Do not describe the whole section as
   gated or ungated.

3. **Pull live figures from MCP** for the current month and upcoming bills. Cross-check the
   bill amounts against section 3's paid range and its `ok` / `under-budgeted` / `seasonal`
   classification.

4. **Write the assessment** in the terminal, following the rules below.

5. **Publish the report page.** Every run ends with the artifact updated — it is part of
   the deliverable, not an optional extra. Copy `templates/report.html` into the scratchpad
   and edit two things:

   - **The `REPORT` block** at the top of the `<script>` — the bill series with its
     budgeted amount (section 3's second table), and the cash-flow months with their
     income, expenses and coverage (section 1, which prints all four). That is the *only*
     numeric edit: the renderer below it computes every bar, gridline, tick and label
     from those figures. Never hand-write chart geometry, and never edit the renderer.
     Every figure it needs is in the script's output — if you find yourself writing a
     query to fill this block, that is a gap in `scripts/assess.ts` to close, not a query
     to write.
   - **The prose** — headline, ledger figures, the row stacks, the spellings, the action
     block, the scope row in the masthead. This is the judgement half and gets rewritten
     each run.

   Then publish it to the **same URL**, so there is one link that always holds the current
   assessment rather than a new artifact each month:

   ```
   https://claude.ai/code/artifact/085dbb62-e66f-4a2e-84f9-0e5b370aabaa
   ```

   If that URL ever returns "artifact not found" it has been deleted — publish a fresh one
   and **replace the URL here in the same change**, or the next run hits the same dead end.
   The previous URL died exactly that way and went unnoticed until a run tried to use it.

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
| 3. Bills | **Missed occurrences first** — a due date that passed with no payment, skip or snooze is the most actionable thing in the report. Then **read `swing` before `variance`.** Swing under ~1.5 means a fixed bill, and a high variance there really is a misconfigured figure. A bill marked `seasonal` — and listed again in the second table — is a metered one, where the budget sits inside the range actually paid and no single figure can be right; the month-by-month shape is shown for those. High swing alone is not enough: a bill nobody budgeted anywhere near is `under-budgeted` and still needs its warning. Also bills paid *outside* the bill system, which silently skip the schedule |
| 4. Category trend | Rising categories only; a fall is usually the gap, not thrift |
| 5. Recurring spend | The fixed monthly base, and **new** recurring charges — habits forming before they are noticed. Immaterial ones are dropped on purpose: a faithfully repeating jeepney fare decides nothing |
| 6. Data quality | Three findings, grouped: **duplicates** (same day, description and amount — usually a double-submit); **unlabeled spend** split by cause, where `bill payment` is a **system gap** — bill payments bypass label auto-apply — not user sloppiness, so say which it is; and **fragmentation**, one thing stored several ways, which matters because the Telegram bot searches by description text |
| 7. Income concentration | Share from the single largest source |
| 8. What changed this period | Anomalies against the trustworthy months — a pace that has moved, a category above its baseline, a logging gap. A month still running is compared against the *same days* of those months, never scaled up |

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
- **A bill marked `seasonal` is not a misconfigured one.** That classification requires two
  things — payments swinging 2x or more, *and* the budgeted figure falling between the lowest
  and highest actually paid, so it is right for part of the year. Those bills are listed again
  in section 3's second table with their month-by-month shape. A bill with a high swing whose
  budget sits outside that range (100 budgeted, 300-600 paid) is `under-budgeted`, not
  `seasonal`: it is simply wrong and its variance warning stands. Only the `seasonal` ones get
  this exception; for those, do not report
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

Add an analysis to `src/lib/assessment-facts.ts` and print it from `scripts/assess.ts`.
Both consumers gain it at once: this report and the app's AI Assessment tab read the same
module, and its pure functions are unit-tested without a database.

**Never add a second implementation.** This skill used to carry its own `assess.sql`
computing the same analyses in SQL, and within days the two had drifted — the SQL reported
ten "new recurring charges" where the module reported none, and flagged two rent and wifi
payments as "paid outside the bill" when both predated the bill they were matched to. Same
question, two answers, and nothing to catch it. That is why the SQL is gone (#227).

Keep it read-only, resolve local days through `formatLocalDate` rather than raw `date`, and
keep output narrow — this report is read by a model before a human, and wide result sets
cost tokens without adding insight.
