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

4. **Write the assessment** following the rules below.

## What each section is for

| Section | What to look for |
|---|---|
| 1. Data confidence | Excluded months, logging gaps of 4+ days |
| 2. Headline | Savings rate, monthly burn, months of runway |
| 3. Bill accuracy | `variance_pct` over ~15% — the forecast is wrong, not the spending. Also bills paid *outside* the bill system, which silently skip the schedule |
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
- **Never present the current month as a trend** — it is partial by definition.
- Format money in the user's own currency (the script reports it) with thousands
  separators. Round to whole units; centavo precision is noise at this altitude.
- **End with one action worth doing this week** — the highest-leverage, smallest-effort
  item. One, not a list.
- Offer to publish the assessment as an artifact with the trends charted, in one line.
  Do not build it unless asked.

## Extending

Add a section by appending a `\qecho` header plus one query to `assess.sql`. Keep the
`ld` local-time view rather than raw `date`, keep it read-only, and keep output narrow —
this report is read by a model before a human, and wide result sets cost tokens without
adding insight.
