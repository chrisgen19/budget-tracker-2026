# Changelog

All notable development history for the Budget Tracker app.

## 2026-08-30 - A label that went nowhere

A GCash receipt sent to the Telegram bot with the caption
`Tiendesitas Yosh's Pickleball fee, category fun, label it in pickleball` came back as
"Yosh's Pickleball fee", category Fun, and no label. Two unrelated defects wearing one costume.

The label was never applied because nothing on the receipt path knew what a label was.
`scan_receipt` neither takes nor returns them, `PendingScan` had no field for them, and
`saveConfirmedScan` wrote five fields, none of which was `labelIds`. The directive reached Gemini
inside the caption and had nowhere to go. Underneath that sat a second, quieter reason: omitting
`labelIds` is supposed to mean "let the user's schedules run", but the MCP tool turns an omitted
value into an explicit `[]` for any date `hasTrustworthyTime` rejects — which is every date but
today. So a receipt scanned the morning after the purchase was opted out of labelling entirely,
and would have been even if the caption had been understood. Sending an explicit array is what
gets past that, and it is the right thing to send: the guard exists to stop an *invented* clock
triggering a time-of-day schedule, which has nothing to say about a label the user named
themselves.

The directive is read locally, in `caption-labels.ts`, not by a model. It has to work with no
`GEMINI_API_KEY`, and paying a request to recognise the word "label" is the same trade
`commands.ts` already refuses. Matching is explicit only — `label it X`, `tag as X`, `#X` — and
resolves by exact case-insensitive name against the user's real list, longest name first so
`Work Lunch` is not cut down to `Work`. A bare mention applies nothing: "Pickleball court fee" is
a description, and labelling on it would tag "lunch with the pickleball crew" as a game. A name
that matches nothing the user owns is reported back rather than dropped, because a silently
dropped label is the whole bug, and the bot cannot create one — `create_transactions` is its only
write, which is what stops a leaked token rewriting anything.

Reporting it back needed one more distinction than it first looked. An empty label list means
either "you have no such label" or "I could not read your labels", and `loadLabels` swallows a
failed `get_label_list` into the same `[]` — so the honest-looking reply "create it in the app"
was confidently wrong for a token minted without `labels:read`, and sent the user to the wrong
place to fix it. The lookup now carries whether it succeeded, and every path that can drop a
named label says which of the two happened.

The same hole was in the typed paths, so both were closed: the shorthand logger reads the
directive with no model call, and the classifier may now name labels on a transaction, resolved
against the real list by the same `findByName` the search path uses. A hallucinated label on a
search costs a wrong answer; on a write it lands on the row, and `getLabelBreakdown` splits an
amount across whatever labels it carries, so it quietly moves money.

The dropped "Tiendesitas" was the prompt's own doing. The caption section told the model "the
receipt always wins where the two disagree", which is sound advice about a merchant it can read
and useless about a wallet transfer that prints an account holder and a reference number and
nothing else. Faced with a venue it could not corroborate, the model kept the half it could. The
rule is now scoped to what the receipt actually prints, and says plainly that where there is no
merchant the caption is the only description there is — keep the user's words, place name
included. It also says an instruction in a caption is not description text, and that removing one
must not take the purchase with it.

## 2026-08-29 - Midnight, but whose?

Review of #183 asked what guaranteed a bill due date is stored at midnight UTC, given every
reader assumes it. Nothing did. Twelve server-side sites normalised with `setHours(0, 0, 0, 0)`,
which truncates in the *process* zone — a no-op while the container runs in UTC, and `nixpacks.toml`
pins no `TZ`, so that was luck rather than contract. On a laptop in Asia/Manila, which is the
documented way to run the bot locally, paying a bill due the 5th stores `2026-09-04T16:00:00Z`,
and the field added in #183 then reports the 4th.

The fix is boring where it can be: `utcDayStart` and `addUtcDays`, applied everywhere a due date
is truncated or shifted. What was not boring was `computeNextDueDate`, which turned out to be
wrong in a second way that had nothing to do with timezones. `setMonth(+1)` on 31 January
overflows to 3 March; the clamp that follows then reads *March's* length, finds 31, and returns
31 March. A monthly bill on the 31st skipped February entirely. Building each result from UTC
components removes both problems at once, because a date assembled from `Date.UTC(y, m, d)` never
lands in a month nobody asked for.

That function had no tests at all, which is how a bug like that survives in the scheduling core.
It has fourteen now, including the January case and a check that every result sits exactly on
midnight UTC.

The helpers live in `bill-dates.ts` rather than beside the rest of the bill logic, and the module
imports nothing. `bill-utils.ts` imports `@/types`, which augments `next-auth`; `mcp-server/` has
no such dependency, so the first arrangement type-checked green at the root and failed the MCP
server's own check — the exact split that check exists to catch, caught by it.

One site keeps process-local truncation: the bills page, which runs in the browser, where the
process zone *is* the user's.

## 2026-08-29 - Two kinds of date

#132 asked why `create_transactions` reported "1 September" while the read tools reported
`2026-08-31T17:00:00.000Z` for the same row, and nothing said which convention was which. The
transaction half was settled by adding `localDate` beside the instant. The bill half was left,
deliberately, because it is not the same problem wearing a different hat.

A transaction happens at a moment. A bill due date does not: `nextDueDate` is stored at midnight
UTC and means "the 5th", the way a calendar means it. Running that through `formatLocalDate` looks
like consistency and is a bug -- for anyone west of Greenwich it renders the 4th, and every payment
made on time reads as a day late. So `localDueDate` and `localSnoozeUntil` are produced with
`dayKey(utcDayStart(...))`, which takes the day the value already had and never shifts it, while
`localActionDate` *is* converted, because paying a bill is a moment and 22:30Z on the 4th really is
the 5th in Manila. Three fields, two conventions, and the schemas now say which is which rather
than leaving a model to infer it from a string that looks the same either way.

The tests pin both directions, which matters more than usual here: the plausible mistake is not
forgetting to convert, it is converting the thing that must not be. Reverting the due date to
`formatLocalDate` fails three; leaving the action date unconverted fails one.

`localDay` in `src/lib/telegram/local-time.ts` is deleted. It existed only because the read tools
returned instants, and the bot had to redo the conversion the server could have done; its
docstring said so. With the server naming the day, the workaround is dead code, and the bot now
derives no calendar day at all -- which is what `TELEGRAM_TZ_OFFSET` drifting was ever able to
break.

## 2026-08-29 - The week the server would not name

Asked what a week's spending came to, the only honest answer involved a caveat: the tools filter by
month, so a whole month of rows came back and got bucketed into days by hand -- and since every row
is a UTC instant, a Manila user's 06:00 Wednesday fare, stored as Tuesday 22:00Z, had to be moved
back to the day it actually happened on. Two separate gaps, both of them the client's problem to
solve and both of them easy to solve wrongly.

The second one was already solved, on one side. `formatLocalDate` has existed since
`create_transactions` needed to echo a date back, with a docstring naming this exact failure: a
UTC+8 user's 1 March row is stored as `2026-02-28T16:00:00Z`, so slicing the ISO string claims 28
February for a transaction the app shows on 1 March. It was called in exactly one place, the write
confirmation. Every read query returned `t.date.toISOString()` and left each client to redo the
conversion. So the read rows now carry `localDate` beside `date` -- the instant is still there, for
ordering and for label schedules; the calendar day is no longer a thing each caller derives for
itself.

Ranges are the other half. `parseMonth` already produced a `DateRange`, and every query filters on
`{ gte, lte }`, so `from`/`to` is mostly plumbing -- with one detail that decides whether it works:
both bounds are inclusive, so `to` resolves to 23:59:59.999 of that local day. Resolving it to
midnight would drop everything that happened on the last day of the window while still returning a
confident answer. `month` together with `from`/`to` is refused rather than resolved by precedence,
on the same reasoning that makes the Telegram classifier drop an unresolvable label instead of
passing it through: a filter that applies half of what was asked returns rows indistinguishable
from a complete answer. An impossible day is refused too, because `Date.UTC(2026, 1, 31)` rolls
forward to 3 March rather than failing, and would have quietly queried a window nobody asked for.

Filtering rows was never the whole problem, though. Answering "how much" from a filtered list still
means summing it, and a model summing eighty rows is a model doing arithmetic instead of reasoning.
`search_transactions` now returns `totals` -- income, expenses, net, and per-category subtotals --
computed over every match rather than the returned page. Two `groupBy` queries and a name lookup,
which is cheap next to shipping the rows to be added up.

Two smaller things fell out of the same session. Rows sharing a `receiptGroupId` are one receipt
split across categories, and nothing in the payload said so, leaving a caller to infer it from
matching timestamps and a shared description prefix; the id is now on the row. And `compact` drops
`categoryIcon` and `categoryColor`, which exist for the app's UI, which no analysis reads, and which
are about a fifth of a page's bytes.

Last, nothing in the tool set said what day it was. A client with a shell can work that out; Claude
on a phone cannot, and a model that guesses guesses in UTC, which makes "this week" unanswerable
rather than merely approximate. `get_budget_overview` now reports `today` and `timezoneOffset`. The
tidier option was an MCP resource, and it was deliberately not taken: `MCP_TOOL_SCOPES` gates tools,
so a resource would be a data path no scope narrows, and widening the model to cover resources is a
larger decision than this needed. A field on an existing tool inherits the scope that tool already
has -- which also means no existing token has to be reminted to get any of this.

Five schemas failed `pnpm type-check` the moment the query layer changed, which is `assertExact`
doing precisely what it was written for.

## 2026-08-29 - A way out of the chat

A mistyped shorthand — `1000 breakfast` for a hundred-peso meal — meant opening the app, finding
the row and fixing it. The obvious answer is an undo button, and the obvious answer is wrong.

The bot cannot edit or delete anything. `create_transactions` is the only write among its fourteen
MCP tools, and that absence is a property rather than a gap: a leaked bot token can add junk rows,
but it can never destroy or rewrite financial history. Adding a delete tool to fix occasional typos
would trade that away permanently, and a bug in a delete path is unrecoverable in a way a bug in a
create path is not.

So the confirmation now carries a link instead. `?highlight=<id>` was already a route contract,
used by the bill history: the transactions page clears the month filter, finds that row across all
time and opens its edit modal — which is where editing and deleting already live, with a real UI
for choosing which field was wrong. One tap leaves Telegram; nothing gains destructive power.

The base URL is read from `TELEGRAM_APP_URL` or `NEXTAUTH_URL` and is never hardcoded, on the same
reasoning as `TELEGRAM_MCP_URL`: a fork or a staging deploy must not be handed a link into someone
else's budget. An unusable one omits the button rather than sending a broken URL, because Telegram
rejects the entire message when a keyboard carries one — the failure would cost the confirmation,
not just the link.

The first cut checked that with a prefix pattern, which review caught: it accepts
`https://app.example invalid`, exactly the shape `new URL` refuses. It also used `??` to choose
between the two variables, so a blank `TELEGRAM_APP_URL` — an empty Coolify field — would have been
selected over a perfectly good `NEXTAUTH_URL` and silently disabled the button. That is the same
mistake this file already documents for `TELEGRAM_CURRENCY_SYMBOL` and `TELEGRAM_TZ_OFFSET`, made
again in a new place.

Both are fixed, and the failure they share is now blocked one level lower as well: the plain-text
retries in `sendOne` drop the keyboard. An invalid button fails identically on every attempt, so
the retry loop could not help, and the message it would lose is the confirmation that a
transaction committed — which a user reads as failure and resends, writing a second row under a
new update id. The link is worth less than the receipt.

## 2026-08-29 - Stopping the bot on purpose

Six consecutive deploys produced an identical signature: exactly five `409 Conflict` lines, seven
seconds apart, spanning twenty-eight seconds, then silence. Harmless in themselves — the new
container starts polling before the old one exits, and the loop retries — but the window they
measure was not harmless.

`startTelegramBot` was a bare `while (true)` with no exit path, and nothing in the codebase handled
a signal at all. SIGTERM killed the process wherever it happened to be, including part-way through
a handler. Telegram settles an update only when a *later* `getUpdates` carries a higher offset;
advancing the local variable confirms nothing. So a container killed mid-update left its whole
batch unconfirmed, and the replacement was handed it again.

Replays are survivable for writes, which is what the idempotency work was for: `create_transactions`
keys on the update id and returns the original rows. `scan_receipt` does not, deliberately — it
spends a metered credit and a second read may see the photo differently — so a receipt in flight
during a deploy was scanned and charged twice.

The stop is now deliberate. The flag is checked between updates, never inside one, since a
half-finished update is the state that causes the problem. An idle poll is aborted rather than
waited on: it runs twenty seconds and Docker's default grace period is ten, so waiting is how an
idle bot gets SIGKILLed anyway. A handler in flight is never interrupted — abandoning it is the
thing this exists to prevent. Then one final `getUpdates` at the advanced offset confirms the batch
before the process exits.

Review then found the flaw in doing that only at shutdown. This bot runs inside the Next server,
and Next installs its own SIGTERM handler that calls `process.exit(0)` as soon as the HTTP server
closes — so a confirmation scheduled from our handler is racing that exit, with no guarantee of
winning. The graceful stop was real but its guarantee was not.

So the confirmation moved to where it needs no cooperation from anything: immediately after each
handler returns. That covers SIGTERM, SIGKILL, an OOM kill and a lost race identically, and it
costs one cheap call per handled update, which for a personal bot is nothing. The signal handling
stays, because not abandoning a handler halfway is still worth having, but it is now a courtesy
rather than the mechanism.

What remains unclosed is narrower and architectural: during the handover both containers are
polling, and Telegram hands an update to whichever wins. The replacement can therefore be given an
update the outgoing container is still handling. Closing that needs single-poller ownership or an
idempotent scan, neither of which belongs in this change.

## 2026-08-29 - Buttons on the receipt review

Answering a receipt meant typing "yes", which is the most repeated interaction in the bot and the
most tedious one on a phone. The review now carries Save and Discard buttons.

The bot could not receive them. `if (!update.message) continue` dropped every `callback_query`, so
buttons would have rendered and done nothing at all.

Two things needed care rather than wiring.

A press is not a message: the sender is top-level and the chat hangs off the message the button was
attached to. So it gets `callbackIsAllowed` rather than a widened `messageIsAllowed` — the same two
rules, allowlisted sender and private chat, written separately because reusing the message check
would mean reading `from` off an object that does not carry it, and that fails open. A message
carrying buttons can be forwarded, and the press then arrives from whoever tapped it, so what is
authenticated is the press.

And buttons never expire. A review from an hour ago is still tappable, so `callback_data` carries
the photo's update id and a press whose id does not match the waiting scan is refused. Without
that, scrolling up and tapping Save would confirm whichever scan happens to be pending now —
showing the user one amount and saving another, which is the same failure the frozen-draft rule
exists to prevent.

The typed path still works, and has to: correcting a description needs free text regardless, and
the two now share `saveConfirmedScan` so a button and a typed "yes" cannot drift apart.

That sharing was not enough on its own, as review caught. Clearing the keyboard only happened on
the button path, because the typed path had no idea which message carried it — so answering by
typing left the buttons live on a review that had already been saved, and tapping them later
reported the receipt as expired. True of the draft, misleading about the receipt. `PendingScan` now
holds the review's message id, which is why `sendMessage` returns an id rather than a boolean, and
both terminal paths take the keyboard off. A correction deliberately leaves the buttons in place:
the scan is still waiting under the same update id, so tapping Save then saves the corrected
version, which is what the user would expect.

## 2026-08-29 - The correction the review would not take

The receipt review asked for yes or no and meant it literally. Anything else fell through to
normal handling and was classified as an unrelated message, so answering "groceries at SM" — the
most natural way to fix a description the OCR got wrong — did nothing at all. The scan sat waiting
until its ten-minute TTL, and nothing said the correction had been dropped.

That fall-through was deliberate and is preserved: its comment reads "typing another expense logs
it rather than being refused", and that stays true. So a correction is defined by exclusion rather
than by trying to recognise a description, which has no recognisable shape. A reply corrects the
scan only when it is not a yes or no, does not start with an amount, and is not a command. Both
exclusions are load-bearing and have tests that fail without them: without the first, "100
breakfast" would stop logging while any review was open.

Nothing is re-scanned. The user supplied the words, so there is nothing for the model to read, and
`scan_receipt` is deliberately not idempotent — a second read would spend another scan credit for a
field already known. The category is left alone, which is the honest limit of a description
correction and a separate decision if it turns out to matter.

One state does not accept a correction. When a save fails without settling, the draft is restored
so the user can retry — and the retry replays the same idempotency key. If the first write did
commit, the server returns the original row, so an edit made in between would be shown to the user
and then silently discarded. Such a draft is now marked `frozen` and refuses corrections while
still accepting a yes, which is what actually resolves the ambiguity. This is not a new rule: the
web app's multi-scan review already freezes rows pinned by an unknown outcome, for exactly this
reason, and the first cut of this feature reintroduced the hazard that rule exists to prevent. A
deterministic refusal is different — a lapsed write lease is raised before anything is written — so
those drafts stay editable.

The asymmetry with photo captions is worth stating, since the two look alike and were decided
opposite ways. A caption arrives unbidden and is often not a description at all — "here you go" is
an ordinary thing to send with a photo — so it goes to the model as a hint and is weighed against
what the receipt says. A reply to an explicit invitation is unambiguous, so it is simply used.

## 2026-08-29 - The caption the bot read and threw away

`caption` had been declared on the Telegram message type since photos were supported, with a
comment explaining what it was for, and was read by nothing. Sending a receipt captioned
"groceries at SM" discarded the one piece of context the user had volunteered.

The obvious fix is to use it as the description once the scan returns, and it is the wrong one. A
caption is free text and often is not a description at all — "here you go" is a perfectly ordinary
thing to send with a photo — so a blind substitution would overwrite a correctly-read merchant
name with noise. It also could never reach `categoryId`, which is the field OCR actually gets
wrong and the one a caption is most likely to settle.

So it goes to the model instead, quoted into the prompt as a hint, bounded so a long caption
cannot crowd out the rules that follow it. The model weighs it against what it reads: the receipt
wins wherever the two disagree, because the receipt is evidence and the caption is memory, and the
model is told to read `amount` and `date` from the image alone. A caption that says nothing about
the purchase is ignored rather than forced into the answer.

Two things worth being precise about, both raised in review. The amount/date rule is a steer and
not a guarantee: a prose instruction cannot bind a model, so a caption naming a figure could in
principle be echoed into `amount`. What protects those fields is the confirmation step, which this
flow has always required for exactly that reason — OCR on a crumpled photo is where a wrong amount
comes from, and nothing is written until the user has seen it. And the caption block sits *below*
the category rules rather than above them; the first cut placed it above and told the model to
"follow only the rules above it", which excluded the category list, the category rules and the
response format — an instruction that contradicted itself.

`scan_receipt` grew an optional `caption`, so this is available to every MCP client rather than
only the bot, and every field that comes back is still validated the same way — `amount` positive,
`categoryId` resolved against the user's own list — so a caption cannot talk the scanner into a
bad row.

The review now says "I used your caption as a hint" when one was sent. Same rule as the repaired
receipt year: an inference the user cannot see is one they cannot undo, and the confirmation step
is the moment they can still correct it.

## 2026-08-29 - Two calls, one thinking budget, opposite needs

Phase 1 moved every Gemini call to `gemini-3.6-flash`. The Telegram classifier came back accurate
and, measured in production, "not fast but tolerable" — which is the answer that made the second
step worth taking rather than assuming.

The cause was that `classify.ts` sent no `thinkingConfig` at all, so the model ran at its own
default, `medium`. That is full reasoning effort spent choosing one of eleven action labels from a
prompt that already lists all eleven, paid on the hot path of every free-text message.

The obvious fix is wrong. `GEMINI_THINKING_LEVEL` is shared with receipt scanning, and OCR on a
crumpled phone photo is the one call in this app where deliberation genuinely earns its cost.
Turning it down globally would have bought classifier latency with scan accuracy. So the level is
now per call site: `receiptScanConfig()` keeps the configured level, `classifyConfig()` pins
minimal, and both are built from one `jsonConfig` helper so they cannot drift on anything else.

"Minimal" is not one value, and the first cut of this got it wrong in a way review caught. Picking
the knob by generation — `thinkingBudget` for 1.x/2.x, `thinkingLevel` for 3+ — is necessary but
not sufficient, because the *floor* varies inside a generation. Per Google's support table,
`gemini-3.7-flash` accepts only low/medium/high; `gemini-3-pro-preview` accepts only low/high; and
`gemini-2.5-pro` cannot disable thinking at all, its range starting at 128. Asking any of them for
the cheapest setting a sibling model supports is a 400, which `classifyMessage` catches and turns
into `null`, reaching the user as "I couldn't understand that command" on every free-text message.

So `minimalThinkingFor` resolves per model, and falls back to `low` — the one level present in
every row of the table — rather than to the cheapest one imaginable. The asymmetry is the point:
too much thinking costs latency, an unsupported value costs the whole feature. Note this is not a
Pro-model caveat; the model it would have broken first is a Flash one, and newer than the model
this release moved to. The matrix is now a table-driven test, so a model that ships without
`minimal` degrades instead of taking the bot down.

The subtle half was the fallback. `generateContentWithRetry` rebuilds `thinkingConfig` for whatever
model it switches to, and rebuilt it from the env default regardless of what the caller asked for
— so a deliberate `minimal` was silently restored to `medium` the moment the primary was
overloaded. It now takes a `thinkingFor` callback, defaulted so the four existing callers are
untouched. Rebuilding rather than carrying the caller's config across matters because the two
models need not share a generation: the README suggests `gemini-2.5-flash-lite` as a fast
fallback, and a `thinkingLevel` built for a 3.x primary is the wrong knob for it.

`gemini.ts` had no tests at all, which is how the fallback overwrite survived being written down as
a known trap without being fixed. It has them now, and both reverts were confirmed to fail before
this shipped.

## 2026-08-29 - The model the Telegram bot was actually running

Production sets `GEMINI_MODEL=gemini-3.6-flash`. The Telegram bot was running `gemini-2.5-flash`,
and had been since the day the literal was typed.

It was the only place in the codebase that wrote a model id at a call site. Every other caller —
receipt scanning, itemization, AI Assessment — imports `GEMINI_MODEL`. The literal matched the
default when it was written, so it was correct exactly once, and then the env var moved and
nothing said otherwise. There was no test, because `processNaturalLanguageWithGemini` was a
private function inside an 1,800-line module: nothing could import it to assert anything about it.

The failure mode is why it survived. A worse classifier does not throw. It routes "did I pay
meralco this month" to the wrong handler, or returns a label that resolves to nothing, and the
bot answers something plausible and slightly wrong. Nobody files a bug against a bot for being a
bit dim.

The same function also called the SDK directly rather than `generateContentWithRetry`, so it got
one attempt where receipt scanning gets three plus a fallback model, and a transient 503 was
swallowed and reported to the user as **"I couldn't understand that command."** They rephrase a
message that was already fine. The retry machinery existed; this caller just never reached it.

The classifier now lives in `src/lib/telegram/classify.ts`, reads `GEMINI_MODEL`, and goes through
the retry wrapper. Extraction is the part that matters: it is what allows a test to fail when
either regresses, and both reverts were confirmed to fail the suite before this shipped.

It imports `@/lib/gemini` **dynamically**, and exports `GEMINI_ENABLED` read from the environment
rather than from a constructed client. `gemini.ts` builds `GoogleGenAI` at module scope and throws
without `GEMINI_API_KEY`, so a static import would have turned a graceful degradation — no key,
shorthand-only logging, bot still up — into a crash at boot. The tidier-looking import was the
regression.

The defaults in `gemini.ts` moved to `gemini-3.6-flash` and `gemini-3.5-flash`, so the shipped
default matches what production runs and this class of drift closes for every caller rather than
just this one.

Deliberately unchanged: the thinking level. The classifier is on the hot path of every free-text
message, where latency matters far more than it does for a receipt scan, and a newer model at
`medium` may well be slower at what is fundamentally a routing decision. Changing the model and
the reasoning budget in one step would make a latency regression unattributable, so the model
moved alone and the measurement comes next. Worth knowing before that lands:
`generateContentWithRetry` injects `thinkingConfig` on its fallback path regardless of what the
caller set, so primary and fallback attempts currently reason at different levels, and a per-call
setting would be silently overwritten mid-retry.

## 2026-08-26 - A misread year, and the failures nobody could see

A production scan of a receipt printing `08/26/2026` came back as **2023**-08-26. Month and day
exactly right, year three off. The UI flagged it — `checkReceiptDate` raises `dateWarning`
whenever the year disagrees with today's — so nothing wrong was saved, but the user had to catch
and fix it by hand.

That signature is a misread digit, not a three-year-old receipt: reading a *different* date wrong
almost never lands on today's month and day by accident. So it is now repaired rather than only
flagged, and `dateWarning` stays on afterwards, because the repair is an inference and the person
holding the receipt is the one who can settle it. The guard is deliberately narrow — month and day
must match the photo's exactly. Anything looser would start rewriting dates that were read
correctly, and a wrong date nobody was warned about is worse than a right one they were. A
genuinely old receipt scanned on its own anniversary is the false positive, which needs a 1-in-365
coincidence and costs nothing when it happens, since the warning still shows.

The prompt now also tells the model when the photo was taken and that the year is almost certainly
that year. Measured on its own this was neutral — 3/5 correct dates with it and without — so it is
insurance, not the fix. The repair above is the part that does not depend on the model behaving.

Review found three holes in the first cut of this, and one in the mechanism meant to catch them.

`new Date("2026-02-31T00:00:00")` does not fail — it rolls over to 3 March — so an impossible
date was accepted and handed on verbatim, to be rolled over later by whatever finally parsed it.
`isNaN` only rejects what JS refuses outright, like month 13, which is what the test covering this
actually fed while its comment claimed otherwise. The parsed components are compared back against
the string now.

The repair also ran only when the OCR year disagreed with *today's*, so a receipt dated after its
own photo — impossible, since a receipt cannot be photographed before it exists — returned with no
warning at all. The check is anchored to the photo now, and runs before any same-year shortcut.

And the repair was silent: a corrected date sat behind the same generic "check year" as an
ordinary cross-year receipt, so a wrong correction was indistinguishable from a right one and
could not be undone. `repairedFromYear` now carries the year that was replaced, the review renders
"year corrected from 2023", and `scan_receipt` says so in prose.

The `assertExact` pin that should have caught `repairedFromYear` missing from the MCP schema did
not fire, and the reason generalises: mutual assignability cannot see an added **optional**
property, because `{a}` and `{a; b?}` each extend the other. Every field added to a tool payload
has been optional, so the pin was blind to precisely the drift it exists to catch — including
`breakdownDropped` before this. It compares keys now. The first attempt at that fix was itself
wrong in a way worth recording: a `SameKeys<A, B> extends true` guard always passes, since the
`never` it returns on failure is assignable to `true`.

Separately: `UNREADABLE` was logged nowhere. It reaches the user as "Could not read the receipt.
Please try a clearer photo", which is the wrong advice when the real cause is a receipt heavy
enough to exhaust the output budget — and on a 66-item supermarket receipt that happens often. Both
paths now log `finishReason` and the thinking/output token counts, which separate a blurry photo
(`SAFETY`, or genuinely empty) from a truncated one (`MAX_TOKENS`). Thinking was observed reaching
13.8k tokens against output that never passed ~2.5k.

The log records the response's *shape* — whether it starts as JSON, whether it is terminated —
never its content. Logging the tail was the obvious way to show where a truncated response
stopped, and it would have written merchant names and prices into logs that outlive the request.
`startsAsJson` and `terminated` answer the same question without any of that.

## 2026-08-26 - A supermarket receipt could fail its own scan

Uploading a 56-item supermarket receipt returned `POST /api/receipts/scan 500` and "Failed to
scan receipt. Please try again." The scan had in fact worked: the amount, date, merchant and
category were all read correctly. What failed was `lineItems`, capped at 50 in
`receiptBreakdownItemSchema`, and a single weekly grocery run exceeds that. The whole result was
discarded over the one optional field on it.

Several things were wrong here, so all of them are fixed.

The bound is now `MAX_BREAKDOWN_LINE_ITEMS` (150), one constant shared by the scan-side schema and
the storage-side `receiptBreakdownMetaSchema`. They were separate copies of 50, and raising only
the scan would have produced the worse failure: a receipt that scans cleanly and is then rejected
on save, after the credit is spent. The cap bounds the stored JSON blob rather than describing a
typical receipt, so it sits well above what one realistically holds.

`scanReceipt` no longer discards a scan when only the breakdown is invalid. It retries the parse
without that field and returns the rest, keeping `multiCategory` so the review still offers
Itemize. That is a partial recovery, not a guaranteed one: `/api/receipts/breakdown` validates
against the same `receiptBreakdownItemSchema` and does not degrade, so it can rebuild a breakdown
Gemini merely mis-shaped, but not one whose group genuinely exceeds the item cap. A response
broken anywhere else fails the retry too and still settles as `FAILED`, so this cannot smuggle an
unusable scan through.

Degrading quietly created a second hazard, so the prompt was tightened to match. `lineItems.amount`
is `positive()`, and a "FREE 0.00" or "-25.00 SENIOR DISC" line is ordinary on a supermarket
receipt — the sort of thing that used to fail loudly and *refund* the credit, and would now fail
silently while still spending it. `buildPrompt` never said amounts must be positive, though the
breakdown route's prompt always had; it now does, and states the 150-item and 20-group bounds so
the model stays inside them rather than relying on the drop.

The failure was also invisible: the schema branch returned without logging, so the dev server
showed a bare 500 and nothing else. Both paths now log — the drop and the outright rejection —
with the issue list capped, since it carries one entry per bad line item.

Degrading also changed what a scan costs, which the first pass missed. `use-multi-scan` skips the
second Gemini call when a breakdown is already present — "no second call, no extra credit" — so a
*dropped* breakdown falls through and Itemize spends another scan credit. The button looked
identical either way. `scanReceipt` now reports `breakdownDropped`, the review labels that case as
using another credit, and the MCP output schema carries it too.

`getReceiptItems` needed more than a bigger number. A receipt is several transactions, one per
category, each holding up to the item cap, so any single-blob default truncates an ordinary
itemized grocery run — two 100-item groups returned 150 of 200 while `itemCount` said 200. The
default is now group-aware: a whole receipt's worth when `receiptGroupId` names one, one
transaction's worth otherwise. Truncation is also stated rather than implied, via a new
`truncated` flag, because `itemCount` describes every match and a caller that does not compare
lengths reports a partial receipt as a complete one.

The bounds are named constants in `receipt-limits.ts` — a module with no imports of its own, so
`budget-queries.ts` can read them without pulling zod and the MCP scope schema into the query
layer — and the prompts interpolate them instead of restating 20 and 150 in prose.

Two documentation defects turned out to be real bugs. The `get_receipt_items` tool description
still said "Defaults to 100" after the default moved, and that text is the only contract a model
ever reads. And the `multiCategory` caveat had been written as a JSDoc comment, which is erased at
compile time: `output-schemas.ts` uses no `.describe()` at all, so nothing in it reaches the
client. Both now live in `.describe()`.

`/api/receipts/breakdown` got the same two treatments as the scan path, since it is where a
dropped breakdown is rebuilt: its prompt states the per-group item cap, and its validation
failure logs instead of returning a silent 422. Unifying the two parses outright is issue #139.

A third review pass caught the same defect three times over: a fix written on a channel its
audience cannot read. The `truncated` flag shipped with no `.describe()` — the exact JSDoc trap
fixed for `multiCategory` one field earlier — while the `limit` text still taught the model to
compare `items.length` against `itemCount`. The credit warning on Itemize lived only in `title`
and `aria-label`, neither of which a phone renders, in an app used mostly on phones; it is now a
visible "1 scan" pill. The promo-line rule was added to the scan prompt but not to
`/api/receipts/breakdown`, so the recovery path still failed on the very receipt that triggered
the drop. And `breakdownDropped` was threaded to the client and then never read, with the UI
re-deriving it from `!breakdown?.length`; it drives the pill now, because only the server knows
whether an itemization was lost as opposed to never produced. The `scan_receipt` prose summary
says so too, since prose is what many clients surface.

`scanReceiptOutput` is now pinned to `ScanResultPayload` with `assertExact`, like every read
schema. The file previously declined the pin as describing "AI output rather than a database
shape", but the payload is a repo-local interface, and the failure it guards against is
documented in the same file: a field that reaches `structuredContent` without reaching the
schema is rejected by the SDK client and breaks every scan at the caller.

Smaller: `summarizeIssues` is a shared leaf module rather than two copies; `get_receipt_items`
stops pretty-printing its text channel, since it is the one result whose size scales with a
stored blob and it is already serialized twice; `ReceiptBreakdown` reports `aria-expanded` and
`aria-controls`, which mattered little while it rendered open and matters now that collapsed is
the default.

## 2026-08-26 - Telegram bot runs inside the app

The bot needed somewhere always-on. A second Coolify application would have doubled the build and
the memory on the same VPS to isolate a bot only its owner talks to, so it runs inside the web app
instead, started from `src/instrumentation.ts` on server boot.

That also settled a question the second-application route left open. The deployed image starts
`node .next/standalone/server.js`, and whether `scripts/` and `tsx` survive into it was unverified.
As an imported module the bot is traced into `.next/standalone` at build time, already compiled,
so neither is needed. Confirmed by running the real standalone build: it starts the bot, connects
to production and applies the allowlist.

`TELEGRAM_BOT_ENABLED` gates it, and is set only in the deployed environment. Telegram answers a
second concurrent `getUpdates` for one token with 409 Conflict, so without the flag every
`pnpm dev` would start a poller that fights production. Verified in both directions: the flag on
starts it, the flag absent leaves the server clean.

Nothing in the bot may call `process.exit`: it now shares a process with the budget app, so a
missing token would have taken the app down. Failures throw, and `register()` catches them, so a
misconfigured bot degrades to no bot.

`next.config.ts` ignores the module for non-node runtimes. `instrumentation.ts` is compiled for
edge too, because middleware exists, and the `NEXT_RUNTIME` guard stops the bot *running* there
without stopping webpack tracing `node:https` and `node:dns` into a bundle that cannot resolve
them.

## 2026-08-26 - Telegram bot: authentication and provenance

A Telegram bot (`scripts/telegram-bot.ts`) was generated by an agent and left running against the
production budget. Reviewed and fixed before it goes any further.

### It served anyone who found it
The poller logged the sender then discarded that identity, calling `handleMessage(message, user)`
where `user` was resolved once at startup from `BUDGET_USER_ID`, or failing that the first account
in the database. There was no chat-id allowlist and no `from.id` check anywhere in its 490 lines.
Since bot usernames are searchable and the `t.me` link is public, any stranger could read balances
via `/summary`, `/recent` and `/bills`, and write transactions by texting "100 breakfast".

It now **denies by default**. `TELEGRAM_ALLOWED_IDS` and `TELEGRAM_ALLOWED_USERNAMES` gate every
message; with neither set the bot refuses everything and says so at startup. A denied message is
logged with the sender's numeric id, so the allowlist can be tightened from ids rather than
usernames, which are weaker because a released handle can be claimed by someone else. Denials are
silent to the sender: a reply would confirm the bot is live and whose it is.

### It disabled TLS verification
`rejectUnauthorized: false`, alongside a hardcoded DNS override to Telegram's IP. The override is
a reasonable answer to a sinkholed resolver; skipping certificate verification is not, and it put
the bot token and every message on a connection nothing authenticates. Verification is back on
with an explicit `servername`.

### It bypassed every write control, and lied about provenance
The bot imports `createTransactionBatch` with its own Prisma client, so it never passes through
`/api/mcp`: no token, no scope, no rate limit. It also stamped `createdVia: "APP"`, making its
rows indistinguishable from ones typed into the app by hand.

Now stamps a new `TELEGRAM` source, and honours the same write lease as MCP through
`assertStillPermitted`, so the kill switch in Profile > MCP Access covers this path too.

### Its idempotency key was decorative
`tg-${Date.now()}-${random}`, regenerated per message. The poller advances its offset *before*
handling and keeps it only in memory, so a crash mid-write makes Telegram redeliver that update on
restart and the transaction is written twice. The key is now derived from the update id, so a
redelivery replays instead.

### It talked to the wrong database
`DATABASE_URL` points at local Postgres, so the bot read and wrote the development copy (288 rows)
rather than production (705). Nothing it logged ever reached the real budget, and the data a
stranger could have read was a stale copy rather than the live account.

It is now an MCP client: it calls `/api/mcp` with a scoped token and holds no database credentials
at all. That reverses the direction of the original problem, since it no longer goes *around* the
token scope, the write lease, the rate limit and the audit trail but through them. It also drops
the user lookup entirely, because the token already decides whose budget is being touched.

One consequence worth recording: rows the bot creates now arrive over MCP, so they are stamped
`createdVia: MCP` with the bot's own token id, and the transactions list marks them "Added by
Claude". That is inaccurate. The honest fix is to derive `created_via` from the token rather than
the endpoint, so a token minted for Telegram stamps `TELEGRAM`; the enum value is added here
against that, unused for now.

### Two commands were broken outright
`pnpm type-check` failed with 10 errors in the script. `/summary` called `getMonthlySummary` with
`month` (the parameter is `months`) and read `.totalIncome` off the returned **array**, so it threw
rather than replying. `/bills` read `nextDueDate` and `frequency`, neither of which exists on
`UpcomingBill`. Both also passed `tzOffset`, which is not a parameter name, so `timezoneOffset`
silently fell back to UTC: the same failure mode that took six review rounds to eliminate from the
MCP path. `/summary` now uses `getBudgetOverview`, and both pass the user's real offset.

## 2026-08-26 - MCP respects auto-apply label schedules

`create_transactions` never ran the user's auto-apply schedules: omitted `labelIds` were
normalised to `[]`. That was the right call when it was made, because a bare date became midnight
and a `05:00-17:00` window could never match it. It stopped being right once dates carried a real
clock, leaving the two writers disagreeing: entering the same weekday lunch through the app tagged
it, through MCP did not.

Schedules now run, gated on the timestamp reflecting reality:

| Input | Timestamp | Schedules |
| --- | --- | --- |
| a time was supplied | real, from the user | applied |
| bare date, and it is today | filled with now, which is what the app's form does | applied |
| bare date in the past | fabricated | **not** applied |

The third row is the whole reason for the gate. A bare date is filled with the *current* clock, so
"yesterday's dinner" entered on a Wednesday morning would carry 08:09, land inside a weekday
05:00-17:00 window, and be tagged as work spending on what is typically the busiest label. An
explicit `labelIds: []` still opts out unconditionally.

The decision is made server-side from what was actually supplied, rather than exposed as a tool
parameter: the model has no information the server lacks, and a lever it can get wrong is worse
than no lever.

### Review follow-up
The tool-level description still said "Scheduled labels are never applied automatically here, so
pass labelIds explicitly", directly contradicting the field-level text right below it. Only the
field had been updated. A client reading the tool description would omit `labelIds` expecting no
labels and receive a scheduled one, which is worse than either behaviour on its own: the metadata
was actively wrong. Both now agree, and the tool level also documents the backdating exception,
which the field has no room for. Verified by reading the served metadata back over a real client
connection rather than by inspecting the source.

### Verification
- `hasTrustworthyTime` covers supplied times, today, past and future bare dates, unparseable input,
  and that "today" is decided in the user's zone rather than the server's
- `verify-mcp-endpoint.ts` 51/51, against a real weekday `05:00-17:00` schedule: a stated
  in-window time is tagged, a stated out-of-window time is not, a backdated bare date is not, and
  an explicit empty list opts out
- Both edges pinned by revert: disabling auto-apply fails the in-window check, and removing the
  gate fails the backdated ones, showing the exact mis-tag
- An existing check asserting "omitting labelIds never auto-applies" had become stale, passing for
  a different reason than its name claimed. Rewritten as the stronger case it actually is: a
  backdated row escaping a schedule that matches every hour of every day, so only the gate can
  withhold the label

## 2026-08-26 - MCP transactions no longer default to midnight

Every transaction written through MCP was landing at 12:00 AM, including ones described as
happening at a particular time ("last night"). Not a timezone bug: the resolution was correct, the
time was simply never supplied.

`create_transactions` accepts either a bare date or a timestamp. A bare date carries no time, and
`resolveTransactionDate` was filling it with local midnight, so anything the user said about
*when* was discarded at the write. It also nudged the day: "last night" became the next day at
00:00 rather than that evening.

**Root cause was the tool description.** It read "Calendar date, e.g. 2026-08-25... A full
timestamp is also accepted", which leads with the date form and never says when a time matters, so
a model had no reason to turn "last night" into `T21:00`. It now says so explicitly, with worked
examples, at both the field and the tool level.

**Midnight was also inconsistent with every other writer.** The transaction form uses a
`datetime-local` prefilled with the current clock, and the receipt scanner's `withLocalTime`
attaches the current clock to date-only OCR output. Measured on the dev database: **0 of 288**
app-created rows sit at exactly 00:00 local, while every MCP row did. A bare date now takes the
user's current wall clock, matching the two existing writers. An explicit time, including an
explicit midnight, is still used as given.

### Verification
- `resolveTransactionDate` covers the filled clock, an explicit time surviving unchanged, explicit
  midnight still being expressible, and a property across five offsets that filling in a clock
  never moves a row to a different day
- `verify-mcp-endpoint.ts` 47/47, including a bare date that is not midnight and stays on the named
  day, and `2026-08-25T21:00` stored as 9pm local
- One existing check asserted the old midnight behaviour and was rewritten to pin the day rather
  than the instant

## 2026-08-25 - Show provenance on the row

Follows #126, which added `transactions.created_via` and an "Added by" filter but no per-row
marker. You could filter the list down to what Claude wrote; you could not tell, looking at the
list, which rows those were. The original request was to *see* them, so settling the mechanism
without delivering the visibility left the feature half done.

MCP-created rows now carry a small sparkle beside the description, following the pattern the
`receiptGroupId` "Itemized" and `billId` "Bill" markers already established. Icon-only rather than
a text badge so it does not compete with the amount on a narrow row; the meaning lives in the
accessible name and the tooltip.

No API, schema or type change was needed: `GET /api/transactions` uses `include` rather than
`select`, so `created_via` was already in every payload the client received, and
`TransactionWithCategory` extends the Prisma row, so it was already typed. Only the render was
missing.

### Review follow-up
The markers moved out of the page into `TransactionRowBadges`. The new conditional had no test and
no manual plan, which the repository checklist requires, and arguing it was impractical was the
wrong answer: the markup was only untestable because it sat inline in a route that would have to
be mounted whole, with its providers, router and query client, to assert on one span. Extracting
it made it testable and gave the pre-existing "Itemized" and "Bill" markers their first coverage
too. Both failure directions are pinned: a marker that never appears, and a marker that appears on
every row, which is the one that matters since a false "Added by Claude" is a provenance lie.

Still not a label, for the reasons recorded in #126: `getLabelBreakdown` splits a transaction's
amount evenly across its labels, so a provenance label would divert half of every MCP-written
expense out of its real category, and labels are user-deletable, so the actor could erase the
marker.

## 2026-08-25 - MCP write support

Closes #126. The MCP endpoint could answer questions about the budget but not add to it, so the
receipts workflow still ended with typing everything into the app by hand.

One tool, `create_transactions`, creates a batch in a single write. Editing, deleting, bill
payment and category/label creation are deliberately out of scope; delete in particular is the
only irreversible operation and is a separate decision.

### Three controls, none substituting for another
- **`transactions:write` scope**: least privilege, fixed at mint. Existing tokens carry only
  `:read` scopes so they stay read-only with no migration. A token granted write may not choose
  "Never" and is capped at 90 days, since revocation only helps once a leak is noticed.
- **`users.mcp_writes_enabled_until`**: a lease rather than a boolean. The failure that matters is
  not forgetting to switch writes on, which fails loudly, but forgetting to switch them off, which
  fails silently. A lease returns to the safe state on its own.
- **`transactions.created_via` + `mcp_token_id`**: set server-side, so a compromised token can
  neither forge nor omit them, and not a foreign key, so the record outlives the credential.

Provenance is a column rather than a label because `getLabelBreakdown` splits a transaction's
amount evenly across its labels: a provenance label would divert half of every MCP-written expense
out of its real category, and labels are user-deletable, so the actor could erase the marker.

### A pre-existing gap closed on the way
Neither create path verified that `categoryId` belonged to the caller. Labels were checked;
categories were not, and `Category.userId` is nullable so the foreign key alone is satisfied by any
category that exists, including another user's. Latent while the only caller was the user's own
browser; not latent once a model supplies the id over an internet-facing endpoint.

### Refactor
`createTransactionBatch` in `src/lib/transaction-writes.ts` is now the single create path, injected
with `prisma` and shared by the batch route and the tool. The route keeps its exact HTTP contract:
`scripts/verify-batch-idempotency.ts` passes 24/24 unchanged, including the concurrency and
replay-under-lock cases the client's `committed: "no" | "unknown"` classification depends on.

### Review follow-ups
- The mint form no longer pre-selects `transactions:write`. It initialised from `MCP_SCOPES`, so an
  untouched form would have minted a write-capable token and least privilege would have depended
  on the user noticing a pre-ticked box. `DEFAULT_MINT_SCOPES` is read-only by construction.
- The tool normalises omitted `labelIds` to `[]`. `createTransactionBatch` reads `undefined` as
  "auto-apply a scheduled label", so rows were being tagged despite the tool description promising
  they never are.
- `search_transactions` actually exposes `createdVia` now. The query layer accepted it and the
  docs claimed it worked, but the tool never declared the parameter, so it was unreachable.
- An unparseable date is rejected with a named reason instead of reaching Prisma, failing inside
  the transaction, and surfacing as `UNKNOWN_WHETHER_SAVED`, which tells the caller to retry a
  request that can never succeed.
- `mcpWriteMinutes` is parsed with Zod rather than `Number()`. `Number(true)` is 1 and
  `Number("60")` is 60, so a stray boolean or string could open the write window.
- The write-access panel re-renders when the lease lapses, and its buttons say "Set to" rather
  than "Extend": each option replaces the expiry, so "Extend 1 hour" on a 30-day lease shortened
  it.
- The transactions empty state distinguishes "no matches for this filter" from "no transactions".

### Review follow-ups, second round
- A bare `YYYY-MM-DD` from the model parsed as midnight **UTC**, which is the previous day west of
  Greenwich: a 1 March row from a UTC-5 user landed inside February's range and appeared in the
  wrong month. Every other write path already avoids this (`datetime-local` in the form,
  `withLocalTime` in the scan flow); the tool now resolves bare dates through the same
  `Date.UTC(y, m, d) + tzOffset * 60000` formula the rest of the app uses.
- `2026-02-31` passed validation, because `Date.parse` accepts it and JavaScript rolls it forward
  to 3 March. Storing a different day from the one the user approved is worse than refusing the
  input, so calendar components are now checked to survive the round trip.
- A failed `/api/preferences` read left the write-access panel showing "off". That is the
  safe-looking answer, not the true one: an active lease would have been invisible and the
  "Turn off now" action absent. The unknown state is now distinct from off and offers a retry.
- The stdio entry point advertised `create_transactions`. It passes no scopes and no lease, so
  every call was guaranteed to fail with a message pointing at a remote setting that does not
  apply to a locally spawned server. The default grant is now read-only everywhere, which also
  means a caller that forgets to pass scopes can never receive write authority.
- An `EXPENSE` filed under an `INCOME` category was accepted. The app's picker filters by type so
  its form cannot produce one, but nothing enforced it server-side, and it would distort every
  breakdown that groups by category.

### Review follow-ups, third round
Both of these were holes left by the previous round's date fix.

- The calendar check only covered bare dates, so appending a time bypassed it entirely:
  `2026-02-31T00:00:00Z` was accepted and stored as 3 March. `Date.parse` is also far looser than
  the documented format, accepting `"0"`, `"2026"` and `"Mar 3 2026"`, each of which becomes some
  real instant unrelated to what the user approved. Input is now matched against an anchored ISO
  pattern, with the calendar components round-tripped and the time components range-checked.
- The tool echoed a raw UTC slice of the stored instant. Having just made storage timezone-aware,
  that reported the wrong day *because* of the fix: a UTC+8 user's 1 March row is stored as
  `2026-02-28T16:00:00Z`, so the confirmation claimed 28 February for a transaction the app
  correctly shows on the 1st. The echo now uses the user's own offset, and a test asserts it
  round-trips with the value that was stored.

### Review follow-ups, fourth round
Both again fallout from the previous round's fixes.

- The anchored ISO pattern admitted UTC offsets that cannot exist, such as `+24:00` and `+14:61`,
  and the component checks did not look at the offset at all. Those parse to Invalid Date, which
  reached Prisma, failed inside the transaction, and was reported as `UNKNOWN_WHETHER_SAVED`:
  precisely the failure the date validation was added to prevent two rounds earlier. Rather than
  adding a third per-component rule, `isRealDate` now ends with a parse backstop, so anything the
  shape admits must also resolve to a real instant. A property test asserts that nothing the
  validator accepts can produce an Invalid Date.
- The lease re-render timer passed the 30-day duration straight to `setTimeout`, which truncates
  any delay above 2^31-1 ms (about 24.8 days). It fired immediately and, with `expiresAt`
  unchanged, never re-armed, so a page left open for a long lease would still have claimed writes
  were live. The timer now advances in bounded hops.

### Review follow-ups, fifth round
- A timestamp without `Z` or an offset, such as `2026-08-25T23:30`, was passed through to
  `new Date()`, which resolves it against the **server's** timezone. Production runs UTC, so for a
  UTC+8 user that instant renders as the 26th locally: the wrong day, and dependent on where the
  app happens to run rather than on the user. The bare-date fix two rounds earlier covered only
  `YYYY-MM-DD`; `resolveTransactionDate` now treats any zone-less wall-clock reading as the
  user's local time, and passes through anything that pins its own instant.
- The replay guard moved into the shared writer. Label and category validation ran before the
  existing-batch lookup, so a keyed retry whose label had since been deleted was answered with
  `LABELS_NOT_OWNED` even though the batch was already committed. The HTTP route had always
  guarded this with `rejectUnlessAlreadySaved`, but the MCP tool calls the writer directly and had
  no such cover, and a caller reading that rejection as "nothing was written" would resubmit under
  a fresh key and duplicate the rows.
- The endpoint script asserted that the *previous* case wrote nothing after the invalid-offset
  request, so an offset row would not have been caught. Both are now counted separately.

### Review follow-ups, sixth round
- A committed batch can now be replayed even after the write lease lapses. The idempotency
  contract requires a retry under the same key, and refusing that retry because the lease expired
  in between left the caller unable to tell whether the rows existed, which is the state most
  likely to end in a manual duplicate or a resubmit under a fresh key. Deliberately narrow: only
  a lapsed *lease* is bypassed, never a missing scope, the key must be well formed, and the path
  can only read. A caller with no saved batch under that key still falls through to the refusal,
  so the kill switch remains absolute for anything that would actually write, which the endpoint
  script now asserts in both directions.

### Review follow-ups, seventh round
- The token list and the write lease now fail independently. Sharing one try/catch meant a
  preferences outage hid the token list behind "could not load your tokens" even though
  `/api/mcp/tokens` had answered, removing the ability to revoke a credential: the action most
  likely to be urgent, and a worse failure than the misreported lease state the shared catch was
  added to fix. Each half degrades on its own, neither renders a value it did not fetch, and the
  error banner is left for actions rather than repeating what the inline placeholder already says.

### Review follow-ups, eighth round
- The write lease is re-read **inside the write transaction**, not only when the request arrives.
  A batch can hold a transaction for up to a minute, so "Turn off now" would have watched an
  in-flight batch commit anyway, and a client that pipelined several requests would have had them
  all commit after the switch. That is a request-admission check rather than a kill switch. The
  shared writer takes an optional `assertStillPermitted` callback so the lease stays an MCP
  concern; the app route passes none and is unchanged. A replay is deliberately not gated on it,
  since it writes nothing.
- App-created rows are no longer spliced into a transaction cache filtered to MCP. The infinite
  cache splice orders by date and consults no filters, which predates this PR and shows an extra
  row early under the other filters; under this one it would have rendered an app-created row as
  "Added by Claude", which is exactly the claim `created_via` exists to make trustworthy.
- The replay-beats-validation test now asserts the label and category lookups never ran. Its
  outcome alone did not pin the fix: the locked re-check on the rejection path returns the same
  rows, so it passed even with the early branch removed.

### Verification
- 194 unit tests, 56 of them new: the write service (provenance stamping, category and label
  rejection, dedupe, lock-only-when-keyed, replay, unknown-outcome), `resolveWritePermission`, the
  mint cap, and that the write tool is invisible to a read-only token
- `scripts/verify-mcp-endpoint.ts` 44/44 over real HTTP with the SDK client: refusal while the
  lease is off with nothing written, a create once it is live, a replay creating nothing, the
  provenance columns, a cross-user category refused, and the tool absent for a read-only token
- `scripts/verify-mcp-token-auth.ts` covers the lease in both directions against real rows

## 2026-08-25 - Accept X-Api-Key

Follows #123. The remote endpoint worked from Claude Code but could not be connected from Claude
Desktop by either available route, and both failures had the same cause.

Claude Desktop's connector dialog rejects the header outright: "OAuth already sets the
Authorization header. Choose a different name." And `mcp-remote`, the local bridge that exists
precisely for clients without request-header support, reacts to a 401 on `Authorization` by
abandoning the static credential and starting an OAuth flow:

```
StreamableHTTPClientTransport.send -> auth() -> authInternal -> registerClient
HTTP 405: Invalid OAuth error response ... Raw body: Method Not Allowed
```

It attempts dynamic client registration against a path this app does not serve, gets Next's
plain-text 405, and cannot parse it as an OAuth error. `--transport http-only` fails at the same
point, so this is not the SSE fallback.

Both tools read `Authorization` as "this server speaks OAuth". The endpoint now also accepts
`X-Api-Key: <token>`, carrying the raw token with no scheme. Authenticating on the first request
means the 401 that starts either cascade is never emitted. `Authorization` still works and wins
when both are present, so a client that sets it deliberately is never silently overridden.

A third, unrelated benefit: `mcp-remote` splits `--header` arguments on whitespace and warns
`ignoring invalid header argument` for `Authorization: Bearer <token>`, then proceeds
unauthenticated. `x-api-key:<token>` has no space.

### Verification
Tested against a real `mcp-remote` 0.2.1 on Windows, which is the thing that was broken:

```
Using custom headers: x-api-key
Connected to remote server using StreamableHTTPClientTransport
Proxy established successfully between local STDIO and remote StreamableHTTPClientTransport
```

`verify-mcp-token-auth.ts` covers the new header (raw token accepted, a `Bearer ` prefix rejected,
empty treated as missing, unknown rejected, and `Authorization` winning when both are sent).
`verify-mcp-endpoint.ts` covers it over real HTTP.

## 2026-08-25 - Remote MCP Access

Closes #123. The MCP server only worked on one laptop: it spoke stdio, so a client had to spawn
it as a local process, and it read whatever `DATABASE_URL` pointed at.

### The decision
The issue's option **B** was chosen (a static bearer token) over an in-app chat (A) or a full
OAuth 2.1 provider (C).

Where it works, which is the check the issue asked for: Claude Desktop and Claude Code always,
since both let you set request headers directly. **claude.ai in the browser and the mobile apps
work too, but only where request-header authentication is enabled.** Anthropic documents it for
custom connectors, `authorization` is on the accepted header-name allowlist, and the value is
sent verbatim (so the stored value must include the `Bearer ` prefix). It is in beta and rolled
out on request, so an account without it is limited to the two desktop clients, or needs OAuth.

Older sources say flatly that the connector UI accepts OAuth fields only. That was true and is
no longer.

The trade was made deliberately: NextAuth v4 is an OAuth *client*, not a server, so the SDK's
auth handlers have nothing to plug into, and standing up an authorization server (clients,
authorization codes, PKCE, refresh, revocation, DCR) is hard to justify while this is
single-user. If it stops being single-user, C is the right answer.

### Transport
The 12 tools now live in `src/lib/mcp/server.ts` and are served over two transports from one
definition: `mcp-server/` is a thin stdio entry point, and `POST|GET|DELETE /api/mcp` serves the
same server over Streamable HTTP. A second copy of the registrations would have drifted the
moment a tool changed on either side.

The HTTP transport runs **stateless**. A route handler has no process to pin a session to, and a
server instance kept across requests would hand one caller's transport to the next, so each
request builds its own.

`mcp-server/` now links `@modelcontextprotocol/sdk` and `zod` from the root `node_modules`, the
way it already linked `@prisma/client`. This is what makes the shared file safe: a module under
`src/lib/` resolves its imports from the root regardless of which entry point loaded it, so a
separately installed SDK would have put two different `McpServer` classes in one process.

### Auth
Only the SHA-256 of a token is stored. Not bcrypt: the secret is 256 bits of CSPRNG output, not a
guessable password, and every request has to look the row up *by* the digest, which a salted hash
cannot do without reading and comparing every row.

Tokens carry subject-area scopes (`budget:read`, `transactions:read`, `labels:read`, `bills:read`,
`receipts:read`), an optional expiry (90 days by default; "never" is available but never the
default), and revocation. Out-of-scope tools are **removed** from the server rather than rejected
at call time, so a scoped token never advertises capabilities it cannot use. Revocation marks
`revoked_at` instead of deleting, so the row still answers "what was this allowed to do, and when
was it last used" after you suspect it leaked. Every *authentication* failure renders as the same
bare 401: distinguishing "revoked" from "no such token" would confirm to an unauthenticated
caller that the token it presented is real.

Managed from **Profile > MCP Access**. The plaintext is shown once and never stored.

### A bug the verification script caught
The rate limiter is a fixed window applied in one atomic `UPDATE`, so concurrent requests
serialise on the row lock instead of all reading the same pre-write count. The first version
bound `Date` objects into `$queryRaw` and enforced nothing: Prisma maps `DateTime` to `timestamp
without time zone` holding UTC, but a bound `Date` is sent as `timestamptz` and compared through
the session timezone. Under Asia/Manila every window looked 8 hours stale, so the limiter reset
on each request. Reads have the mirror-image problem, which would have made `Retry-After` wrong
by the same 8 hours. Every instant is now computed and returned inside SQL.

This is the only ceiling on how hard a leaked token can be pulled: every tool is a database read
and nothing else bounds request volume.

### Review follow-ups
- `GET /api/mcp` returns 405 rather than serving the standalone SSE stream. The SDK client opens
  one as soon as `initialized` is acknowledged; in stateless mode that built a `ReadableStream`
  and a keep-alive timer on a per-request transport nothing ever writes to, and nothing closed
  either. Measured before the fix: the request was still open when the probe aborted it at 6s.
- The rate limit is charged before the revoked/expired branches. A revoked token was exempt from
  the only ceiling in the system, which is backwards: revocation is the response to a leak.
- Revoking an already-revoked token succeeds instead of 404ing. Two tabs listing the same token
  is ordinary, and "Failed to revoke" for a credential that *is* revoked is the worst possible
  moment to tell the user the opposite of the truth.
- The scope labels describe what the tools return. `receipts:read` and `bills:read` both carry
  the parent transaction's description and amount, so a token narrowed to either still exposes
  individual transactions; the old copy implied otherwise.
- A failed token fetch no longer renders as "No tokens yet" with a retry-free empty state.
- `rate_window_start`'s UTC invariant is documented on the model and asserted in the verification
  script. The migration's `DEFAULT CURRENT_TIMESTAMP` does resolve to the session zone (measured:
  8h skew when it fires), but Prisma supplies the value on every real insert, and hand-editing
  the default makes `prisma migrate diff` report permanent drift, so the guard is the invariant,
  not the DDL.

### Verification
- `src/lib/mcp/server.test.ts`, `src/lib/mcp/scopes.test.ts`: scope filtering, read-only
  annotations, and a guard that every registered tool has a scope entry
- `scripts/verify-mcp-token-auth.ts`: needs real Postgres for expiry, revocation, the rate limit,
  and a 40-way concurrent burst that admits exactly the remaining allowance
- `scripts/verify-mcp-endpoint.ts`: drives the real route with the SDK's own HTTP client

## 2026-08-25 - Batch Replay Race

Closes #121. The replay pre-check on `POST /api/transactions/batch` was an unlocked read, so a
concurrent attempt holding the advisory lock but not yet committed was invisible to it. The
retry then fell through to a 400 gate, and the client reads a 4xx as proof nothing was written
(`definitelyNotCommitted` in `use-multi-scan.ts`): it drops the idempotency pin and unfreezes
the rows, so a corrected resubmit creates the batch a second time.

The window is real. A batch is bounded at 60s by `BATCH_TX_OPTIONS`, and the retry path exists
precisely because a response can be lost while the server is still working.

Predates the #119/#120 work: on `main` before it, the pre-check was already unlocked and label
ownership validation already sat between it and the lock. The reachable trigger is a label
deleted while a slow batch is in flight, which needs no deployment skew. The sixth review round
of the 2026-08-20 receipt scan work fixed the *sequential* version of this by moving the
existence check ahead of the label query; that fix is correct and still holds, it just cannot
cover a concurrent attempt, because the check it moved is unlocked.

### Approach
The rejection path re-checks under the lock, rather than acquiring the lock before all
validation. `rejectUnlessAlreadySaved` takes the key's advisory lock, which blocks until any
in-flight attempt finishes, turning "no rows yet" into a decision rather than a guess. Only a
request about to be rejected pays for it; the successful path keeps the fast unlocked read, and
the lock is not held across label validation or `getScheduleContext`.

If the lock cannot be obtained in time it returns **500, not the original 4xx**. A 500 reads as
*unknown* to the client, which keeps the rows pinned — the safe direction when the server
genuinely cannot tell whether the batch exists.

Applied to both 4xx exits that can follow the pre-check: label ownership, and the `ZodError`
branch for payload validation. Scoped to `POST`; the `DELETE` handler has no idempotency key
and is unchanged.

### Verification
`scripts/verify-batch-idempotency.ts` gained a genuinely concurrent case, because the existing
"replay survives a label deleted since" check is sequential and passes against the broken code:
A commits before B starts. The new case holds A open — lock taken, rows written, not committed
— fires B, then commits A. Run against a real dev server, 24 checks pass, and reverting the
guard fails it with `got 400, want 200`.

### Review follow-up (#122): the race check was sleep-based
The first version of the concurrent case used two `setTimeout`s, which made it unreliable in
both directions:
- The delay before starting B did not guarantee A held the lock and had written. If B got there first it would take the lock, see nothing, and 400 — **failing a correct implementation**
- The delay before releasing A did not prove B had reached the rejection path. If B started late, A committed first and B's *unlocked* pre-check returned 200 — **passing even with the fix reverted**, which is exactly what the check exists to catch

The second is the serious one: `AGENTS.md` requires that reverting a fix makes its test fail,
and this could silently not. It only worked when first run because the route was warm from
twenty earlier checks. The 2026-08-20 entry already records this lesson from the scan-quota
harness: "a verification script that cries wolf under a supported configuration stops being
trusted."

Both sleeps are gone. A signals once it actually holds the lock and has written, and B is
released only once `pg_locks` shows a session genuinely blocked on an advisory lock (or B has
already answered without reaching one). Confirmed deterministic: two consecutive runs pass with
the fix and two fail without it, at `got 400, want 200`.

### Files
- `src/app/api/transactions/batch/route.ts` -- `rejectUnlessAlreadySaved` on both 4xx exits
- `scripts/verify-batch-idempotency.ts` -- concurrent in-flight replay case, synchronised on real lock state

## 2026-08-24 - Receipt Breakdown Write Validation

Closes #119. `transactions.receipt_breakdown` was persisted with no validation at all: the only
schema covering it was `receiptBreakdown: z.any().optional()` on `batchTransactionSchema`, and
`POST /api/transactions/batch` stored whatever the client sent. The blob is assembled
client-side and posted back, so nothing between Gemini and the database checked its shape.

Not for lack of schemas: `receiptBreakdownLineItemSchema` and `receiptBreakdownItemSchema`
validate the Gemini *scan response* thoroughly, but that is a different structure. The thing
actually stored, `ReceiptBreakdownMeta`, had none.

### Why it mattered
- **The renderer had no guard.** `receipt-breakdown.tsx` reads `breakdown.items.length` with no check, so a stored blob missing `items` was a render-time `TypeError`, not a degraded display. The call site reached it through `as unknown as ReceiptBreakdownMeta` -- a double cast asserting a shape nothing verified, the pattern the 2026-08-20 entry already records as having shipped bugs
- **Nothing bounded the size.** `MAX_BATCH_TRANSACTIONS` caps a request at 200 *rows*, but each row's blob was unbounded, so request size effectively was too
- **It pushed the burden onto readers.** `getReceiptItems` (#114) had to parse defensively precisely because the column carried no guarantee

### Changes
- **`receiptBreakdownMetaSchema`** replaces `z.any()`. Bounds mirror what the client actually produces (`use-multi-scan.ts`): a positive `total`, and 1-50 items reusing `receiptBreakdownLineItemSchema`. `.strict()` keeps unknown keys out, so arbitrary payload cannot ride along inside the JSON column
- **`toReceiptBreakdownMeta`** narrows a value read from the column, replacing the double cast in `transaction-form.tsx`. Tightening the write path does not make *existing* rows safe, so anything already stored still has to be narrowed rather than asserted. Deliberately duplicated rather than shared with `parseReceiptBreakdown` in `budget-queries.ts`, which imports Prisma as a value and must not reach a client bundle

### Deliberately not included
Rejecting non-positive item amounts on the **read** path, raised in review on #115 and declined
there: receipts legitimately carry `0.00` lines (free or promotional items) and negative lines
(discounts, coupons, returns), so dropping them on read would turn unusual-but-real data into
silently missing data. The write schema does require positive amounts, matching what the scan
path already enforces, so representing discounts would be a deliberate future decision on both
sides rather than an accident on one.

### Verification
All 16 existing rows were checked against both halves: the new write schema accepts 16 and
rejects 0, and the renderer narrowing keeps 16 and drops 0. So no stored data regresses.

### Tests
Thirty-eight more (117 total), in two new files. `validations.test.ts` covers the shape the
scan flow produces plus ten malformed blobs that were previously storable, the item-count and
name-length bounds, and unknown-key rejection. `receipt-breakdown.test.ts` covers narrowing
nine unusable shapes to `null`, keeping the valid entries of a partly malformed blob, and the
total fallback. Both were confirmed to fail with their fix reverted.

### Review follow-up (#120)
- **Tightening the payload schema put it ahead of the replay lookup, which could duplicate committed transactions.** `POST /api/transactions/batch` ran `batchSchema.parse(body)` before checking whether the batch already existed. A batch accepted under the old permissive schema, whose response was then lost, would have its exact retry rejected with 400 by the new schema. The client reads a 4xx as proof nothing was written (`definitelyNotCommitted` in `use-multi-scan.ts`), drops the idempotency pin and unfreezes the rows, so a corrected resubmit creates the batch a second time.

  This is the same failure the sixth review round on the 2026-08-20 receipt scan work already fixed once, when it moved the existence check ahead of the *label ownership* query for exactly this reason. The tightened schema reintroduced it one layer up, outside that protection. The replay lookup now runs before `batchSchema.parse`; a key that is absent or malformed cannot match an existing batch, so it falls through to normal validation, and the authoritative dedupe under the advisory lock is unchanged.

  Not reachable with the current client, which only ever builds a conforming blob, and all 16 stored rows pass the new schema. Fixed anyway because `AGENTS.md` documents that a 4xx means nothing was written, and the route can only keep that promise if it never rejects a batch that exists — today that held by luck, and the next schema change need not.

  `scripts/verify-batch-idempotency.ts` gained the case, driven against the real HTTP route: a replay whose payload the current schema rejects still returns 200, while the same payload on a *first* attempt is still rejected with 400. Reverting the ordering fails it with `got 400, want 200`.

### Files
- `src/lib/validations.ts` -- `receiptBreakdownMetaSchema`, wired into `batchTransactionSchema`
- `src/app/api/transactions/batch/route.ts` -- replay lookup moved ahead of payload validation
- `scripts/verify-batch-idempotency.ts` -- stale-payload replay case
- `src/components/transactions/receipt-breakdown.tsx` -- `toReceiptBreakdownMeta`
- `src/components/transactions/transaction-form.tsx` -- narrows instead of casting
- `src/lib/validations.test.ts`, `src/components/transactions/receipt-breakdown.test.ts` -- new

## 2026-08-24 - MCP Structured Output

Closes #116. All 12 tools now declare an `outputSchema` and return `structuredContent`
alongside the existing text, so clients get a declared shape and real structured data instead
of a JSON string to parse. Deliberately last: it touches every tool, so it waited for the tool
set to stop growing (#110, #112 and #114 each added one).

### Two findings that shaped it
- **The SDK does not validate `structuredContent` against `outputSchema`.** Verified against the installed 1.30.0: a tool declaring `{ total: z.number() }` and returning `{ total: "not a number" }` is passed straight through with no error. A schema that drifts from what the tool returns will not fail loudly, it will quietly misinform every client that trusts it
- **`content` is not auto-filled from `structuredContent`.** Returning only the structured half would leave clients that do not support it with nothing, so every tool returns both

### Drift is a build failure, not a silent lie
`mcp-server/src/output-schemas.ts` pins each schema to the type the query layer already
returns:

```ts
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
assertExact<z.infer<typeof categorySpending>, CategorySpending>(true);
```

Confirmed to catch all three directions of drift: a schema dropping a field, a schema retyping
a field, and `budget-query-types.ts` gaining a field the schema lacks. Since #102 made this
package type-checked in CI, each is a failed build. This deliberately avoids rewriting the
app's shared types as zod, which would have pulled `/api/assessment/*` into an MCP-only change.

### Behaviour change: array tools gained a wrapper key
`structuredContent` must be an object, but five tools returned a bare JSON array. They now
return a named key, applied to **both** halves so each tool has one shape rather than two
descriptions of the same data:

| Tool | Key |
|---|---|
| `get_spending_by_category` | `categories` |
| `get_top_expenses` | `expenses` |
| `get_monthly_summary` | `months` |
| `get_category_list` | `categories` |
| `get_label_list` | `labels` |

The eight object-returning tools are unchanged.

### Note
`structuredContent` needs an index signature and interfaces do not get one implicitly, so the
payload is widened through `Object.fromEntries(Object.entries(value))` rather than an `as`
cast, which would assert a shape instead of producing one.

### Verification
All 12 tools answered against the live database with `content` and `structuredContent`
serialising identically, 12 of 12, no mismatches.

### Files
- `mcp-server/src/output-schemas.ts` -- new; 12 schemas with drift assertions
- `mcp-server/src/index.ts` -- schema declarations, dual-payload returns
- `AGENTS.md` -- records why the assertions exist

## 2026-08-24 - MCP Receipt Line Items

Closes #114. Last of the three data gaps from the MCP audit. 11 tools become 12.

Receipt scanning stores Gemini's per-item detail on `transactions.receipt_breakdown`, and
`receipt_group_id` ties together the transactions of one multi-category receipt. Neither was
visible to MCP, so the finest-grained spending data in the app could not be queried at all.
Live on this account: 116 line items across 16 transactions and 7 receipt groups.

### New tool
**`get_receipt_items`** returns line items flattened across transactions, each carrying its
transaction, category, date, and `receiptGroupId`. Filterable by month, by item name
(case-insensitive), or by `receiptGroupId` to pull one whole receipt.

Flat rather than nested by receipt: the common questions aggregate across receipts ("how much
on coffee this month?"), which is far easier over a list than a tree. Returning the group id on
each item still lets a caller drill into a single receipt.

### The blob is validated, not cast
`receipt_breakdown` is `Json?`, so it arrives as `unknown`. The 2026-08-20 entry records this
exact class of bug shipping before: "Every field was cast with `as` and none was checked, so a
200 missing `amount` or `categoryId` produced a `success` row holding `undefined`." Entries are
type-checked individually, so a malformed or partially written blob is skipped rather than
producing items with missing fields, and the valid entries of a partly broken blob survive.

`breakdownTotal` is reported as stored. The app's `ReceiptBreakdown` component displays the
stored total rather than recomputing from items, so the two can legitimately disagree and
neither is silently substituted for the other. It falls back to summing the items only when the
stored total is absent or unusable.

### Verification
All 116 live items were cross-checked against the raw JSON: the tool reports exactly 116, and
every one appears verbatim in the stored blob. Group filtering was confirmed against a real
receipt spanning two transactions.

### Tests
Nine more (79 total), covering the flattening, four shapes of malformed blob, partial
corruption, the total fallback, a stored total disagreeing with the item sum, case-insensitive
search, `limit` capping only the returned rows while counts cover every match, timezone-resolved
months, and group filtering.

### Review follow-up (#115)
- **The JSON null filter used a plain `null`, which Prisma's typed API does not accept.** `NOT: { receiptBreakdown: { equals: null } }` fails to compile when written against the typed client (`Type 'null' is not assignable to 'InputJsonValue | JsonNullValueFilter | ...'`), and the `Record<string, unknown>` shape these where-clauses are built as hid it. Now uses `Prisma.DbNull`.

  The review reported this as a P1 that stopped the tool executing. That part is not true and was checked before changing anything: plain `null`, `Prisma.DbNull`, and `Prisma.AnyNull` all return the same 16 rows on 6.19.2, which matches the tool having returned all 116 items when the feature was verified. The real issue is narrower and still worth fixing: the query relied on behaviour Prisma's own types declare unsupported, with nothing to catch it changing under a version bump. Every other where-clause in the module was checked and type-checks clean, so this was the only one using the escape hatch.

  `budget-queries.ts` now imports the `Prisma` namespace as a value rather than only types, which is a small departure from its dependency-injected design, taken deliberately for the sentinels. A test pins the sentinel, confirmed to fail if it regresses to `null`, and live output is unchanged at 116 items.

- **Row limits fall back instead of silently truncating or reversing.** `slice(0, -1)` quietly drops the last row, `slice(0, NaN)` returns nothing, and Prisma reads a negative `take` as "from the end", reversing the window. All three look like real answers. `safeLimit` sends anything that is not a positive safe integer to the caller's default, applied at all four sites that take a limit (`getTopExpenses`, `searchTransactions`, `getBillHistory`, `getReceiptItems`) rather than only the one raised, since fixing one of several identical call sites is how the `timezoneOffset` drift in #112 happened.

  Not reachable today: the MCP boundary already validates every limit with `.int().min(1).max(N)` and returns `-32602`, and nothing else calls these functions. The guard is a second line, deliberately clamping rather than throwing, so the library never invents data while telling the caller they were wrong stays the boundary's job. The suggested fix would have accepted `limit: 0`, which `slice(0, 0)` turns into an empty result for a parameter documented as a maximum.

### Files
- `src/lib/budget-queries.ts` -- `getReceiptItems`, `parseReceiptBreakdown`
- `src/lib/budget-query-types.ts` -- receipt item types
- `src/lib/budget-queries.test.ts` -- receipt coverage
- `mcp-server/src/index.ts` -- tool registration
- `README.md`, `AGENTS.md` -- tool table and counts

## 2026-08-24 - MCP Bill Payment History

Closes #112. Second feature item from the MCP audit. 10 tools become 11.

`ScheduledTransactionLog` records what actually happened to every bill occurrence -- `PAID`,
`SKIPPED`, or `SNOOZED`, with the `dueDate` it was for and the `actionDate` it was acted on --
and none of the tools could see it. `get_upcoming_bills` only reports what is due next, so the
whole payment-behaviour question ("how often do I pay rent late?", "which bills do I keep
skipping?") was unanswerable.

### New tool
**`get_bill_history`** returns both the individual occurrences and a per-bill summary, so one
call answers "what happened" and "what is the pattern". Per occurrence: description, category,
due date, status, action date, `daysLate`, whether a transaction was created, and any
`snoozeUntil`. Per bill: occurrence count, the split by status, paid-on-time versus paid-late,
and average and worst lateness. Called without a `billId` it covers every bill, so it doubles
as bill-ID discovery and no separate list tool is needed.

### Lateness is measured in local calendar days, and it matters here
`dueDate` is stored at midnight UTC while `actionDate` is a real timestamp, so subtracting them
directly gives fractional days and mis-rounds for anyone off UTC. Both sides are truncated to
the user's local day first.

This is not theoretical on this account. Two of the six real occurrences change answer:

```
BRV   actionUTC=2026-03-09T22:09Z = 2026-03-10 06:09 Manila -> 5 days late, not 4
PLDT  actionUTC=2026-03-19T21:36Z = 2026-03-20 05:36 Manila -> 0, on time, not 1 day early
```

Bills get paid late at night Manila time, which lands on the next UTC day. A first hand-check
of this data using UTC dates produced both of those wrong, which is exactly the failure the
truncation prevents.

Two further decisions:
- **Negative `daysLate` is kept, not clamped.** "Usually two days early" is a real answer
- **`SKIPPED` and `SNOOZED` carry no lateness and are excluded from the averages.** Neither has
  a payment date to be late relative to, so folding them in would make the averages meaningless.
  They still count toward the occurrence total and their own status tallies

### Tests
Ten more (60 total): the late-night Manila case and the same payment for a UTC user (which must
differ), same-local-day reporting 0 rather than negative, early payments keeping their sign,
skipped/snoozed having null lateness, averages excluding them, null rather than `NaN` when
nothing was paid, no bills returning empty, worst-first sort ordering with unmeasurable bills
last, and `limit` capping occurrences while summaries still cover the window.

### Review follow-ups (#113)
All three were confirmed against the code and by running them, not taken on trust.
- **The due date was being shifted into the user's timezone, breaking every user west of UTC.** `dueDate` is date-only: stored at midnight UTC, meaning "the 5th", not an instant. Converting it the same way as `actionDate` moved it to the 4th for a UTC-5 user, so a payment made on the due date reported as one day late, and that error propagated into `paidOnTime`/`paidLate`, the averages, and the summary ordering. Only real instants get the timezone conversion now; the due date is read as its stored calendar day. A UTC+8 account cannot see this bug, which is why testing against production data missed it
- **One scheduled occurrence could be counted several times.** Snoozing deliberately does not settle an occurrence (`bills/[id]/action/route.ts` is the one branch of four that skips `alreadySettled`), so the same bill and due date accumulates a SNOOZED row per snooze plus a final PAID or SKIPPED. Counting per row reported a snoozed-twice-then-paid occurrence as three occurrences with three outcomes. Rows are now collapsed per `(billId, dueDate)`: `status` is the settled outcome, `snoozeCount` records how many times it was snoozed, and the status counts sum to `occurrences`. New `totalSnoozes` keeps the raw snooze volume, which legitimately can exceed the occurrence count. The `status` filter matches the settled outcome, so a snoozed-then-paid occurrence counts as PAID
- **The lookback window overflowed on month-end days.** `Date.UTC(y, m - 6, 31)` for a 31st in a shorter target month rolls forward: six months before Aug 31 became Mar 3, silently trimming three days off the front. Clamped to the target month's last day

Seven more tests, each confirmed to fail with its fix reverted.

### Review follow-ups, second round (#113)
- **Occurrences reported the bill's nominal amount, not what was paid.** `ScheduledTransaction.amount` is the bill's *current* configuration: Pay & Edit can change the amount at pay time, and editing a bill rewrites the apparent cost of all its history. `/api/bills/[id]/history` already resolves this by reading the linked transaction and exposing `paidAmount`, so the MCP tool was contradicting the app's own bill history screen. It now reads the same source and exposes the same field, keeping `amount` as the nominal value. **This was wrong on real data, not hypothetically**: of six production occurrences, two differ — Mirea Rent nominal 22000 against 22010 paid, and Meralco nominal 5500 against 6513 paid
- **The history window had no upper bound.** `/api/bills/upcoming` surfaces bills due up to a week ahead and offers pay and skip on them, which writes a log with a future `dueDate`. With only `gte`, those landed inside a window the response advertises as ending today, and counted into the summaries and averages. Bounded at `today`. Nothing is lost: the window trails, so that due date is picked up once it arrives

Three more tests (70 total), again each confirmed to fail with its fix reverted.

### Files
- `src/lib/budget-queries.ts` -- `getBillHistory`, local-day helpers
- `src/lib/budget-query-types.ts` -- bill history types
- `src/lib/budget-queries.test.ts` -- lateness coverage
- `mcp-server/src/index.ts` -- tool registration
- `README.md`, `AGENTS.md` -- tool table and counts

## 2026-08-24 - MCP Label Support

Closes #110. Labels are a first-class feature of the app and were completely invisible to the
MCP server: `Label`, `LabelSchedule`, `TransactionLabel`, and `BillLabel` all existed, the
analytics page already rendered a LabelBreakdown chart, and none of the 8 tools could see any
of it. "How much did I spend on Work Budget last month?" was unanswerable. Largest remaining
gap in MCP coverage; 8 tools become 10.

### New tools
- **`get_label_breakdown`** — spending (or income) grouped by label for a month, with an `"unlabeled"` entry for untagged transactions
- **`get_label_list`** — labels with transaction counts, `applicableTo`, and any auto-apply schedules. The counterpart to `get_category_list`: without it there was no way to discover label IDs

### `search_transactions` gained labels
- A `labelIds` filter (matches a transaction carrying *any* of the given labels)
- Each returned transaction now carries its labels. The result shape previously had no label information at all
- An empty `labelIds: []` is ignored rather than matching nothing, so "no filter chosen" does not silently return zero rows

### Matching the analytics page, deliberately
`getLabelBreakdown` mirrors `/api/analytics` rather than defining its own arithmetic, so the
same question gets the same answer in both places:
- **A transaction's amount splits evenly across its labels.** A 1000 expense tagged with two labels contributes 500 to each, so label amounts sum to the period total instead of double counting it
- **`transactionCount` counts a transaction once per label**, so the counts deliberately do *not* sum to the transaction total. Documented on the type, since the two fields behaving differently is surprising otherwise
- Percentages are against the period total including unlabeled
- `"unlabeled"` is appended only when something is actually untagged

Verified against production data: across 2026-02, 2026-03, and 2026-04 the label amounts sum
to the period total exactly, and the even-split path is genuinely exercised — 3 real
transactions carry more than one label.

### Tests
Eleven more in `src/lib/budget-queries.test.ts` covering the even split, the per-label count,
the unlabeled bucket, percentages against the full total, sort order, an empty month (no
divide-by-zero), the EXPENSE default, timezone resolution, `BOTH` labels matching either type
filter, and the empty-`labelIds` case.

### Files
- `src/lib/budget-queries.ts` -- `getLabelBreakdown`, `getLabelList`, label filter and output on search
- `src/lib/budget-query-types.ts` -- label types
- `src/lib/budget-queries.test.ts` -- label coverage
- `mcp-server/src/index.ts` -- two tool registrations, `labelIds` on search
- `README.md`, `AGENTS.md` -- tool table and counts

## 2026-08-24 - MCP Tools Declared Read-Only

Closes #108. All 8 tools moved from the deprecated `server.tool()` to `registerTool`.

### Why it is worth more than a deprecation fix
- **Every tool now declares `annotations: { readOnlyHint: true }`.** All 8 are read-only by design (the server has no write path at all), but nothing told the client that. A client that knows a tool is read-only can auto-approve it instead of prompting, which is the difference between asking "what did I spend on food?" and answering a permission prompt per question
- Each tool gained a human-readable `title` for display, separate from its machine name

### Unchanged on purpose
Tool names, input schemas, and returned content are identical. This is a registration-surface
change, not a behaviour change.

### Not done here
`registerTool` also supports `outputSchema`/`structuredContent`, which would replace
`JSON.stringify(result, null, 2)` in a text block with real structured output. That duplicates
the return types from `budget-query-types.ts` as zod schemas and changes what every client
receives, so it belongs in its own change.

### Note
This was blocked until #102. With the package untypecheckable, rewriting all 8 registrations
was unverifiable, and the `TS2589` repro in that issue hit `registerTool` too under zod 4. It
type-checks in ~2.2s now that zod is pinned to the app's 3.x line, which was the specific risk
worth confirming.

### Verification
- `cd mcp-server && pnpm type-check` clean in ~2.2s, no `TS2589`, no heap growth
- Over the wire: all 8 tools list with `readOnlyHint=true`, a title, and byte-identical names and input schemas
- Data still correct against the live database, and validation still rejects `month: "2026-13"` and `limit: 999`

### Files
- `mcp-server/src/index.ts` -- 8 registrations migrated
- `AGENTS.md` -- records the read-only declaration

## 2026-08-24 - MCP Audit Cleanup

Closes #106. Correctness papercuts, dead config, and stale docs left over from the MCP audit.
No user-facing behaviour changes beyond rejecting input that previously produced a silently
wrong answer.

### Correctness
- **`month: "2026-13"` is rejected instead of silently answering for January 2027.** All six month arguments validated with `/^\d{4}-\d{2}$/`, which accepts `00` and `13`-`99`; `parseMonth` then rolled over (`2026-00` became December 2025) and the tool returned `[]`. An LLM caller reads `[]` as "you spent nothing", not "that month does not exist". Tightened to `/^\d{4}-(0[1-9]|1[0-2])$/`. Verified `2026-01` and `2026-12` still pass while `2026-00`, `2026-13`, `2026-1` and `abcd-12` are refused with `-32602`
- `searchTransactions` no longer joins `bill`. `include: { category: true, bill: true }` pulled the relation on every search and every paginated page, and nothing in the mapped result read it
- The MCP server disconnects Prisma on `SIGINT`/`SIGTERM` rather than leaving the pool to process teardown
- The MCP server advertises `instructions`, so clients have a signal about when to reach for it beyond the individual tool descriptions. It states that months resolve in the user's timezone and that every tool is read-only

### Dead config
- **`pnpm.onlyBuiltDependencies` moved from `package.json` to `.npmrc`.** pnpm 10.32 stopped reading the `pnpm` field, so the 16-package build allowlist applied to nothing and every pnpm command printed a warning about it. Checked before assuming breakage and nothing was broken: `sharp` ran, the Prisma query engine binary was present, and `bcrypt` was in the list without being a dependency at all (the app uses `bcryptjs`, pure JS). It was dead config plus noise, not a broken build
- **It deliberately did not move to `pnpm-workspace.yaml`,** the other supported home. Adding that file makes pnpm treat the repo as a workspace root, and `cd mcp-server && pnpm install` then walks up and installs the *root* instead of the MCP package -- which would silently defeat the CI type-check guard added in #102. Confirmed by testing: with the workspace file present the MCP install printed the root's `postinstall`/`prepare`, and scoping it with `packages: ["."]` did not help. The `.npmrc` route keeps the MCP install standalone
- `bcrypt` dropped from the list, since it is not installed

Verified with a real clean install (`rm -rf node_modules && pnpm install --frozen-lockfile`),
not just by the warning disappearing: allowlisted packages now run their build scripts, and
the only remaining `Ignored build scripts` entries are `protobufjs` and `unrs-resolver`, which
are not on the allowlist and are correctly denied. Deny-by-default is the intended posture.

### Docs
- `AGENTS.md` model list corrected. It named a `Bill` model that does not exist; recurring bills are `ScheduledTransaction` (`@@map("scheduled_transactions")`). Added the missing `ScheduledTransactionLog`, `BillEmailLog`, `BillLabel`, `AiAssessment`, and `AiUsageLog`. Same schema-vs-docs drift #102 was about

### Still open
- The 8 `server.tool()` calls remain on the deprecated API; migrating to `registerTool` (with `annotations.readOnlyHint`, which lets clients auto-approve read-only calls) is its own change
- Tools return bare numbers with no currency, though `users.currency` exists
- No MCP coverage for labels, bill payment history, or receipt line items

### Files
- `mcp-server/src/index.ts` -- month validation, `instructions`, shutdown handling
- `src/lib/budget-queries.ts` -- dropped the unread `bill` join
- `.npmrc`, `package.json` -- build allowlist rehomed
- `AGENTS.md` -- model list

## 2026-08-24 - Timezone-Aware Budget Queries

Closes #104. `src/lib/budget-queries.ts` resolved every month boundary in UTC while the rest
of the app resolved them in the user's stored timezone, so the same transaction landed in
different months depending on which surface you looked at.

Confirmed against production data for a UTC+8 account (`timezone_offset: -480`): of 288
transactions, `Apple Subscription` at `2026-02-28T23:45Z` is `2026-03-01T07:45` in Manila.
The dashboard filed it under March; `budget-queries.ts` filed it under February.

### Correctness
- **`parseMonth` and `currentMonth` take a `tzOffset`** and use the same formula as `/api/dashboard` and `analytics-period.ts` (`Date.UTC(...) + tzOffset * 60000`), so there is one convention in the codebase instead of two. The offset threads through `getSpendingByCategory`, `getTopExpenses`, `getBudgetOverview`, `getSpendingTrends`, and `searchTransactions` (which had its own inline UTC range)
- **`getMonthlySummary` buckets by the user's local month**, and derives "now" from their local day rather than the container clock. Previously both the window edges and the per-month bucketing were UTC, so a boundary transaction was attributed to the wrong bar of the trend chart
- **The AI daily tip was internally inconsistent.** `/api/assessment/daily-tip` already computed `monthStr` in local time and already passed `timezoneOffset` to `getUpcomingBills`, then handed that same local month to `getBudgetOverview` and `getSpendingByCategory`, which re-resolved it as UTC. The tip could quote figures that did not match the dashboard the user was reading. Both calls now pass the offset
- `/api/assessment/generate` needed no change: it only calls `getUpcomingBills`, which was already timezone-aware

### MCP server
- Passes the user's offset to all seven date-scoped tools. `get_upcoming_bills` in particular was computing overdue against the container clock, even though `getUpcomingBills` had accepted a `timezoneOffset` since `8465df7` -- the MCP call site was never updated, which is the drift #102 added type-checking to catch
- **An unknown `BUDGET_USER_ID` now fails at startup** with a message naming the id and pointing at `pnpm db:studio`. It previously connected happily and every tool returned zeros and empty arrays, which reads as "you have no transactions" rather than "you are misconfigured". The startup lookup was needed for the timezone offset anyway

### Compatibility
`timezoneOffset` is optional and defaults to 0, so callers without user context keep the
previous UTC behaviour rather than breaking. The tradeoff is that a caller who forgets it
gets silently wrong months instead of a type error, so `AGENTS.md` now says to pass it
explicitly from anything holding a user.

### Tests
`src/lib/budget-queries.test.ts` is new; the module had no coverage at all despite taking
its `PrismaClient` by injection specifically so it can be driven without a database. Ten
tests over the boundary case, using a stub client that captures the `where` Prisma would
have been given. Checked by reverting the fix: 7 of the 10 fail against the old UTC-only
code. The 3 that still pass are the UTC-fallback tests, which are meant to hold in both
states since they guard the backward-compatible default.

### Verification
- End to end through the real MCP server against the live database: searching `2026-03` for a Manila user returns `Apple Subscription`, and `2026-02` returns nothing. Before the fix it was the reverse
- A bogus `BUDGET_USER_ID` exits 1 with the named error; a missing one keeps its existing message
- All 8 MCP tools still answer, and argument validation still rejects `month: "not-a-month"` and `limit: 999` with `-32602`
- `pnpm lint`, `pnpm type-check`, `pnpm test` (39 passing), and `cd mcp-server && pnpm type-check` all pass

### Known gap
`month: "2026-13"` still satisfies the tools' `/^\d{4}-\d{2}$/` and rolls forward to January
2027, returning an empty result rather than an error. Not addressed here.

### Files
- `src/lib/budget-queries.ts` -- timezone-aware month helpers, offset threaded through
- `src/lib/budget-query-types.ts` -- `timezoneOffset` on the month-scoped params
- `src/lib/budget-queries.test.ts` -- new
- `src/app/api/assessment/daily-tip/route.ts` -- passes the user's offset
- `mcp-server/src/index.ts` -- startup user lookup, offset on every date-scoped tool

## 2026-08-24 - MCP Server Dependency Declaration & Type Checking

Closes #102. `mcp-server/src/index.ts` was the only file in the repo with no static
verification of any kind, and it is the glue layer between the 8 MCP tools and
`src/lib/budget-queries.ts`.

### The gap
- **Undeclared dependencies.** `mcp-server/package.json` declared only `@modelcontextprotocol/sdk`, while `index.ts` also imports `zod` and `@prisma/client`. After installing, `mcp-server/node_modules` held only `@modelcontextprotocol`; both other imports resolved by walking up into the app root. That worked only because the server sits inside this repo with the app's dependencies installed, which is not a property of the package
- **zod split brain.** Because `zod` was undeclared, pnpm's `autoInstallPeers` pulled `zod@4.3.6` in to satisfy the SDK's peer range, and that is what TypeScript resolved. The runtime resolved `zod@3.25.76` from the app root. The file was type-checked against a different major version of zod than it ran on
- **Type-checking the package crashed.** `tsc -p mcp-server/tsconfig.json` died with `Ineffective mark-compacts near heap limit` after ~140s. Bisected to a single tool registration: one `server.tool()` (or `registerTool()`) call against SDK 1.27 + zod 4 emits `TS2589: Type instantiation is excessively deep and possibly infinite`, and eight of them exhaust the 4 GB default heap. Isolated repros confirmed SDK 1.27.1 + zod 4.3.6 fails while both SDK 1.27.1 + zod 3.25.76 and SDK 1.12.1 + zod 3.25.76 are clean, so declaring zod at 3.x fixes all three items at once
- Nothing else covered the directory either: root `tsconfig.json` excludes `mcp-server`, `vitest.config.mts` scopes `include` to `src/**`, and CI never entered it

This had already caused a silent regression. `mcp-server/src/index.ts` had one commit, from
the original March feature, while `src/lib/budget-queries.ts` had three since. One of them,
`8465df7 fix(assessment): timezone-aware upcoming bills in AI context`, added a
`timezoneOffset` param to `getUpcomingBills` for the assessment route. The MCP tool never
passed it, so overdue flags there still follow the container clock instead of the user's
local day. That bug is tracked separately; this change is about the reason nobody noticed.

### Changes
- `mcp-server/package.json` declares `zod` (`^3.24.0`, the app's line) and `@prisma/client`, adds `tsx` and `typescript` as devDependencies, and gains a `type-check` script
- **`@prisma/client` is declared as `link:../node_modules/@prisma/client`, not a version range.** Declaring it normally installs a physically separate, *ungenerated* copy into `mcp-server/node_modules`, and the type-check then fails with `Module '"@prisma/client"' has no exported member 'PrismaClient'`. Generating a second client would work but leaves two clients to keep in sync against one schema. The link is also the honest model: this package already imports `../../src/lib/budget-queries.js`, whose functions are typed against the app's generated client, so it was never independent of it
- `packageManager` pinned to `pnpm@10.32.1`, matching the root. Without it, corepack fell through to whatever pnpm is installed globally, which resolved a different dependency set and wrote `allowBuilds` placeholders the pinned pnpm does not use
- **New `mcp-server/.npmrc`.** npm config is read from the install cwd, and this package has its own lockfile and install step, so the root hardening never applied to it. Verified: `minimum-release-age` read as `undefined` in `mcp-server` against `10080` at the root, with no `~/.npmrc` in play. The MCP server was the one dependency tree in the repo installing with no supply-chain quarantine
- CI gained an install and a type-check step scoped to `mcp-server`, ordered after the root install because the root `postinstall` generates the Prisma client this package links to

### Docs
- README setup no longer tells you to run `npx prisma generate --schema=../prisma/schema.prisma` inside `mcp-server`. That step generated the second client this change exists to avoid; the link makes it unnecessary. Installing the app's dependencies first is now an explicit step, since the link depends on it
- The Claude Desktop config example points at `mcp-server/node_modules/.bin/tsx` rather than `npx tsx`, which runs the pinned version and avoids npm printing `Unknown project config` warnings about this package's `.npmrc` on every launch
- `AGENTS.md` records why `zod` is pinned and why `@prisma/client` is linked, so neither reads as an oddity worth "cleaning up", and adds a note to run the MCP type-check when changing `budget-queries.ts` or `budget-query-types.ts`

### Verification
- `cd mcp-server && pnpm type-check` passes in ~2s, against a 140s OOM crash before
- Confirmed it actually catches drift rather than merely passing: adding a required 4th parameter to `getTopExpenses` in `budget-queries.ts` produced `src/index.ts(68,26): error TS2554: Expected 4 arguments, but got 3`, then the change was reverted
- The two new CI steps were run locally as written, from `mcp-server/` (`rm -rf node_modules && pnpm install --frozen-lockfile --engine-strict && pnpm type-check`). Root `pnpm lint`, `pnpm type-check`, and `pnpm test` were run separately and pass
- The server still works end to end: driven over stdio with a real MCP client, all 8 tools returned live data, and argument validation still rejects `month: "not-a-month"` and `limit: 999` with `-32602`
- Regenerating the lockfile floated the SDK from 1.27.1 to 1.30.0. Type-check and the stdio smoke test were both re-run on it

### Files
- `mcp-server/package.json` -- declared dependencies, `packageManager`, `type-check` script
- `mcp-server/.npmrc` -- new; supply-chain hardening mirroring the root
- `mcp-server/pnpm-lock.yaml` -- regenerated under pnpm 10.32.1
- `.github/workflows/ci.yml` -- MCP install + type-check steps
- `README.md`, `AGENTS.md` -- setup and rationale

## 2026-08-20 - Test Infrastructure (Vitest + React Testing Library)

Added because the review rounds on the receipt scan work kept finding the same class of
defect: React lifecycle interactions that lint and `tsc` cannot see. Stale reads after an
`await`, state updates split across renders, and effect cleanup ordering. Four of those
shipped and were caught only by review.

### Setup
- **Vitest 4 + React Testing Library 16** on jsdom. `vitest.config.mts` (`.mts` so Vite loads it as ESM without adding `"type": "module"`), `vitest.setup.ts` for jest-dom matchers, RTL cleanup, and the `matchMedia`/`scrollTo` stubs jsdom does not implement
- `pnpm test` and `pnpm test:watch`; `pnpm test` added to the CI workflow after type-check
- Tests colocated as `src/**/*.test.ts(x)`. Nothing imports them, so they stay out of the Next.js bundle
- Dependency versions were chosen to clear the repo's 7-day `minimum-release-age` quarantine rather than bypassing it, so the newest release of three of them is intentionally not used
- `@testing-library/jest-dom` and `@testing-library/user-event` were dropped rather than downgraded. Neither was used: every matcher in the suite is a vitest built-in. jest-dom 7 floors at Node 22, so removing the unused dependency dissolved the constraint instead of pinning an October 2025 release to work around it
- CI installs with `--engine-strict`, so a dependency whose `engines.node` excludes the CI Node version fails at install naming the package, rather than surfacing later as a crash inside a vitest pool worker
- `jsdom` is pinned to the 29.x line, not 30.x. jsdom 30 requires Node `^22.22.2 || ^24.15.0 || >=26`, and both CI and production run Node 20 (`nixpacks.toml` pins `nodejs_20`). Pinning the test runner rather than moving the runtime keeps the decision to upgrade Node a separate, deliberate one

### Review follow-ups
- **The label-preservation tests asserted their own arithmetic.** They reproduced `input.labelIds ?? current.labelIds` inside the test and passed the already-merged result to `updateItem`, while the real merge lived in `AppShell`. Reverting the production fix left all of them green — the exact failure this suite exists to prevent. The semantics moved into `updateItem`, which now drops keys explicitly set to `undefined` rather than writing them over what is there, so the tests exercise production code. It also fixes the class rather than the one field: any omitted value now leaves the existing one intact, while an explicit `[]` still writes, keeping "opted out" distinct from "never chose"
- `engines.node` raised from `>=20.0.0` to `>=20.19.0`. Vite 8, jsdom and `@vitejs/plugin-react` all floor at `^20.19.0`, so the declared range promised support the test stack could not deliver — on Node 20.0-20.18 it installs with warnings and then dies inside the vitest pool worker

### Coverage
Twenty-nine tests over the two areas that actually regressed. Each was checked by reverting the
fix it covers and confirming it fails:
- `src/components/ui/modal.test.tsx` — the ref-counted body scroll lock, including two modals closing in the same commit (the case that left the page unscrollable) and restoring a pre-existing `overflow` value
- `src/hooks/use-multi-scan.test.tsx` — `scanSingle` returning its outcome instead of reading stale state, unreadable images vs network failures, non-JSON error responses, malformed 200 responses, retained images on failed rows, retry, a failed save leaving the queue intact, failed rows surviving a partial save, itemising being frozen while a save is in flight (which otherwise creates the receipt twice), the batch idempotency key surviving a failed save, staying pinned to the rows it was sent with, and rotating after a successful one, failures being classified as definitive or unknown, rows staying frozen while unconfirmed, labels surviving a second edit, and the discard accounting for retryable rows

`scripts/verify-scan-quota.ts` stays as it is: it exercises Postgres advisory locks and
transaction isolation, which jsdom cannot provide.

## 2026-08-20 - Receipt Scan Save & Recovery

### Data loss
- **A failed Save All no longer destroys the queue.** The catch flipped every reviewed row to `error`, a state whose only action is Delete, stranding the data behind a UI that could not save it -- and taking the already-spent scan credits with it, usually for a transient error. A failure now leaves the queue untouched and surfaces a toast, so pressing Save again is all that is needed
- **Save All could exceed the batch cap and fail every row.** `POST /api/transactions/batch` capped at 50 while one upload can expand well past that once receipts are itemised into per-category children, turning the overflow into a generic `Invalid input` -> "Failed to save." The cap is now a shared `MAX_BATCH_TRANSACTIONS` of 200, and the client checks the count first with a message naming the actual number
- **Closing the review modal confirms first.** Escape, an overlay click, or a mobile swipe-down silently discarded every scanned receipt. It now names how many rows would be lost and that re-scanning spends the allowance again
- **Failed scans can be retried.** Error rows offered only Delete, so a single Gemini 503 in a ten-file batch permanently lost that receipt. The compressed image is now kept on the row as soon as compression finishes rather than only on success, so Retry re-scans the same photo -- and the failed attempt was already refunded server-side

### Review follow-ups
- **Nested modals left the page unscrollable.** Each `Modal` snapshotted and restored `body.style.overflow` itself, so the discard confirmation opening over the review sheet captured the review's own `"hidden"`. Closing both in one commit ran the cleanups in tree order: the review restored the real value, then the confirmation restored `"hidden"` over it, and nothing could scroll until a reload. Scroll locking is now ref-counted across all mounted modals, so only the last unlock restores and the order stops mattering. Affects every modal in the app, not just this flow
- **A partial save discarded the rows that failed.** Save All posted the successful rows and then reset the whole queue, so in a mixed batch the failed scans vanished along with the retry path added in this same change. Only the saved rows are removed now; failures keep their retained image and stay in the review, with a toast naming what still needs attention
- **Closing skipped the confirmation when every scan had failed.** The discard check counted only savable rows, so an all-failed batch reset silently on Escape or a swipe-down and destroyed the retry queue. Retryable rows are counted too, worded separately because their attempts were refunded and re-scanning costs only the trouble of picking the photos again

### Review follow-ups (second round)
- **Itemising during a save created duplicate transactions.** Save All snapshots the rows it submits; expanding a submitted parent into per-category children mid-flight left those children outside `savedIds`, so they survived the save and the next one recreated the same expenses. Queue mutations are now frozen while a save is in flight, guarded in the hook and disabled in the UI
- **A malformed scan response could poison the whole batch.** Every field was cast with `as` and none was checked, so a 200 missing `amount` or `categoryId` produced a `success` row holding `undefined`; `saveAll` then asserted them non-null and the server rejected the entire atomic batch with `Invalid input` — exactly the batch-wide failure this change exists to remove. Required fields are validated and a malformed body becomes a retryable per-row error. It also stops `withLocalTime(undefined)` throwing on `.slice` and being reported as a network problem
- `itemsRef` is synced in an effect rather than written during render. React may discard a render, and a ref written in one can leak a queue that was never committed into `saveAll` and `retryItem`
- The batch path reported compression failures on the row instead of uploading the original, which usually tripped the server's 4 MB limit and reported a misleading cause. Matches what the single-capture path already did. HEIC is unaffected: `compressImage` resolves with the original there rather than rejecting
- The success-row Remove button gained the `aria-label` the changelog already claimed for it, the category-load warning is a `role="status"` live region since it can appear after the modal opens, and the error row uses `gap-2` so Retry is not flush against a destructive Remove
- Removed a dead copy of `withLocalTime` left in `AppShell` when the logic moved to the hook

### Review follow-ups (third round)
- **Retrying an ambiguous save could duplicate every transaction.** `POST /api/transactions/batch` carried no idempotency key and always created new rows, so a batch that committed but whose response was lost (a dropped mobile connection, a proxy timeout) looked exactly like one that never ran — and this change's own failure toast invites the user to retry. The route now accepts a `clientBatchId` and replays instead of re-creating, serialised with a `pg_advisory_xact_lock` on the key so a double submit cannot race the existence check. The client holds the key across a failure and clears it once a save lands. Verified end-to-end in `scripts/verify-batch-idempotency.ts`: without the key a retry of three rows creates six
- **Editing a scanned row twice dropped its labels.** `TransactionForm` omits `labelIds` when the picker was not touched, so a second edit of any other field passed `undefined` straight through and wiped the labels chosen in the first. Save All then omitted the field entirely, and the server auto-applied schedule labels over the user's choice. Restores the `?? existing` fallback that the pre-refactor handler had, keeping an explicit `[]` (opted out) distinct from `undefined` (auto-apply)
- **Not every scan 403 is a spent allowance.** `receipt-guard` also returns 403 when scanning is off for the user or their role, and treating all of them as quota exhaustion pinned the local count to the limit and showed a false, sticky "No scans remaining this month". The 403s now carry a machine-readable `code`, and only `LIMIT_REACHED` mirrors the exhausted allowance

### Review follow-ups (fourth round)
- **A retried save could silently drop a receipt.** The idempotency key survived a failed save but the payload was rebuilt from the live queue, so retrying a failed scan and saving again resent a *grown* batch under the same key. The server replays only what that key already created, while the client marked everything it submitted as saved — so the newly scanned receipt was removed from the review without ever being created. An unacknowledged attempt now pins its rows alongside its key and resends exactly those; anything scanned since stays queued for the next save, which gets a fresh key

### Review follow-ups (fifth round)
- **Pinning the payload made corrections silently ineffective.** Pinning stopped a grown queue losing receipts, but the review still offered Edit and Remove on those rows while the retry replayed the pinned copy — so a corrected amount was discarded without a word, and a removed row was created anyway. Failures are now classified by whether anything could have been written: every 4xx the route returns is raised before it opens a transaction, so nothing was, and the pin is dropped for a corrected resubmission. A 5xx or a lost response is genuinely unknown, so the rows stay pinned, are frozen in the review behind an "Unconfirmed" badge, and the Save button becomes "Finish Saving N Receipts". Editing what a replay would ignore is no longer offered
- **A full 200-row keyed save could exceed Prisma's transaction deadline.** The keyed path awaits each create in turn, so a maximum batch is 200 sequential round trips plus label associations against a default 5s timeout. Blowing it rolls the batch back and returns a generic 500 — the exact failure the raised batch cap exists to allow. Explicit bounds of 10s wait / 60s duration

### Review follow-ups (sixth round)
- **A replay was judged on inputs it never uses.** The route validated explicit-label ownership before checking for an already-committed batch, so a retry whose label had since been deleted returned 400 for a batch that existed. The client reads 400 as proof that nothing was written, which unfroze the rows and let a corrected resubmit duplicate them under a fresh key. The existence check now runs before that validation: a replay creates nothing, so the validity of its creation inputs is irrelevant to it. The authoritative dedupe still happens under the advisory lock, unchanged. `scripts/verify-batch-idempotency.ts` covers a replay whose label was deleted since, and a first attempt with an unknown label still being rejected

### Correctness
- A compression failure reported itself as "Network error. Please check your connection", sending the user to debug a connection over an image that never left the device. It now says the image could not be read
- Error responses are parsed defensively. An unhandled server fault returns HTML, and `res.json()` rejecting on it made every such failure look like a network problem
- A 403 syncs the local remaining-scans count to the enforced limit, instead of leaving the banner claiming scans that the API will refuse
- `scanSingle` returns its outcome rather than reading the row back out of state. `patchItem` only schedules a render, so awaiting it and then inspecting the item saw the stale `scanning` status and opened the review modal even after a failure
- Closing the scan sheet and opening the review modal batch into one render. Split across renders both modals are mounted for a frame, and the sheet's unmount cleanup then restores `body.overflow` and drops the review modal's scroll lock

### Loading and error states
- `MultiScanReview` uses the shared `useCategoriesQuery` instead of a raw `fetch` with no error handling, where an error response would be assigned straight into `categories` and throw on `.find`. It also stops refetching on every open. A failed category load now degrades to a notice and leaves the receipts savable, since categories only drive the per-row icon and name
- Retry, Remove, and Edit buttons carry `aria-label`s

### Structure
- Scan orchestration moved out of `AppShell` (760 lines) into `src/hooks/use-multi-scan.ts`: capture, the review queue, itemisation, retry, and the atomic save. `AppShell` is down to 460 lines

### Files
- `src/hooks/use-multi-scan.ts` -- new; all receipt scan orchestration
- `src/components/app-shell.tsx` -- consumes the hook; adds the discard confirmation
- `src/components/multi-scan-review.tsx` -- retry action, React Query categories, category-load error state
- `src/lib/validations.ts` -- `MAX_BATCH_TRANSACTIONS`
- `src/types/index.ts` -- `MultiScanItem` carries `photoDate`/`photoDateTime` so a retry can rebuild its request

## 2026-08-20 - Receipt Scan Quota Enforcement

### Cost and abuse control
- **Failed scans no longer cost the user a credit, and no longer cost nothing to an abuser.** `scanLog.create` ran only on the success path, so every unreadable image, non-receipt, and malformed Gemini response consumed real API budget while consuming no quota -- and `generateContentWithRetry` can spend up to five Gemini calls per request (three attempts plus a fallback model). Credits are now *reserved* before the Gemini call and refunded on any failure, so the user is only charged for output they can use. Because the monthly limit therefore no longer bounds spend, a rolling per-user rate limit on scan *attempts* now does: 120 attempts per 15 minutes, sized so a 50-image upload plus itemising every one of them stays under it. Rate-limited requests return 429 with `Retry-After`
- **The monthly limit could be overshot by concurrent requests.** The check was `count`, compare, then insert after the Gemini round trip, which is not atomic -- and the client makes it reachable in normal use, since multi-scan uploads run three requests in parallel. Reservations are now serialised per user with a transaction-scoped Postgres advisory lock. An `INSERT ... SELECT ... WHERE (count) < limit` was tried first and silently enforced nothing, because under READ COMMITTED every concurrent statement reads the same pre-insert snapshot
- **Oversized uploads are rejected before they are buffered.** The 4 MB check ran after `request.formData()` had already read the whole multipart body into memory; App Router route handlers have no default body limit. `Content-Length` is now checked up front and refused with 413

### Review follow-ups
- **The rate limit had the same race the monthly limit did.** The attempt count ran before the transaction and outside the advisory lock, and unlimited plans never took the lock at all, so a concurrent burst slipped past the one control that now bounds Gemini spend. Both checks moved inside the locked transaction, and every plan takes the lock -- unlimited plans skip only the monthly check
- **Reservation TTL is derived from the Gemini retry policy** instead of a fixed 10 minutes. Worst case on default settings is ~5m04s (three primary attempts plus two fallback attempts at `GEMINI_TIMEOUT_MS` each, plus backoff), but raising or disabling that timeout could let a live request outlive its own reservation, letting another request take the last credit before the original settled `SUCCESS`. New `src/lib/gemini-limits.ts` holds the timing policy so callers can reason about call duration without importing the Gemini client
- Reservation transactions set explicit `maxWait`/`timeout`. Prisma's 2s/5s defaults are tight once concurrent uploads serialise on one user's advisory lock, and exceeding them throws instead of returning a clean quota denial
- Both routes call the guard inside their `try`. It reads the multipart body and hits the database, so a rejection escaped the handler and returned an HTML 500 the client could not parse as JSON, surfacing as a misleading "Network error"
- `guardReceiptRequest` split into `checkBodySize`, `resolvePermissions`, and `validateUpload`, keeping each unit inside the size target
- **The reservation TTL is no longer capped below the worst case it is meant to exceed.** Capping at an hour held at the 60s default but broke once `GEMINI_TIMEOUT_MS` went above ~12 minutes, where the worst case reaches 75 minutes -- reintroducing the exact expiry-while-running bug the derivation was added to prevent. Uncapped for timed configs; the hour now applies only to untimed ones, where no worst case exists to derive from and a single credit of overshoot is an accepted, documented limit
- The TTL invariant is verified across a sweep of `GEMINI_TIMEOUT_MS` values rather than whichever one the process booted with. The single-config assertion passed while the invariant was violated
- The harness's stale-reservation checks derive their window from `RESERVATION_TTL_MS` instead of a hard-coded 30 minutes, and a matching check confirms a reservation just *inside* the TTL still holds its credit. The fixed window reported false failures on correct code at longer timeouts, which is worse than no check: a verification script that cries wolf under a supported configuration stops being trusted
- `settleScanReservation` retries before giving up. A lost settlement skews the quota in both directions: an unsettled `SUCCESS` expires at the TTL and silently refunds a scan the user did receive, while an unsettled `FAILED` holds a credit until then. It still never throws, since a completed scan becoming a 500 is worse than a miscounted credit

### Access control
- **A deleted account with a live session could scan without limit.** Sessions are JWTs, so the token outlives the user row; both routes gated their entire permission block on `if (!isAdmin && user)`, and a null `user` skipped scan-enabled checks and the monthly limit together. Missing users now get 401
- **The per-user Receipt Scanning toggle is enforced server-side.** Only the role-level `AppSettings` flag was checked, so a user who turned the feature off in Profile > Features could still call both endpoints directly

### Correctness
- The quota month is computed in the user's timezone via `users.timezone_offset`, matching how the rest of the app handles date boundaries. It previously followed the container clock, so an Asia/Manila user's allowance reset at 08:00 local on the 1st
- The scan route and the breakdown route had drifted to *different* month boundaries -- one server-local, one UTC. Both now share one definition, along with the upload validation and permission checks they had each copied, in the new `src/lib/receipt-guard.ts`
- The "N scans remaining" banner counts what the API enforces. `(app)/layout.tsx` had its own third copy of the month-window query, which would have reported refunded failures as spent

### Files
- `src/lib/scan-quota.ts` -- new; reserve/settle/count credits, month window, rate limit
- `src/lib/receipt-guard.ts` -- new; shared upload validation, permission checks, and credit reservation for both receipt routes
- `scripts/verify-scan-quota.ts` -- new; runnable checks for the concurrency, refund, stale-reservation, timezone, and rate-limit rules
- `prisma/migrations/20260820120000_add_scan_log_status/` -- adds `ScanStatus` to `scan_logs` (existing rows backfilled `SUCCESS`)

## 2026-08-20 - Bill Reminder Correctness

### Data integrity
- **Out-of-order pay/skip no longer discards unpaid occurrences.** `getPendingRemindersForUser` only walks forward from `nextDueDate`, but `pay`, `skip`, and `pay_existing` advanced it from the occurrence that was acted on. Paying the third card in the banner jumped `nextDueDate` past the first two, which had no terminal log and could never be regenerated. Each action now resolves `nextDueDate` with `advanceToNextUnpaidOccurrence`, running on the transaction client after the log insert so it sees its own write. Every transaction opens with a `SELECT ... FOR UPDATE` on the bill row so concurrent actions serialise instead of clobbering each other under Postgres READ COMMITTED. The lock is taken *before* any row referencing the bill is inserted: those inserts hold a `FOR KEY SHARE` lock via their foreign keys, and two transactions upgrading KEY SHARE to `FOR UPDATE` would deadlock
- `scripts/heal-bill-next-due-dates.ts` gained a read-only pass reporting occurrences stranded before `nextDueDate` by the old behaviour. It never rewinds automatically: bills whose `startDate` predates their first payment have legitimately unpaid early occurrences

### Correctness
- Pending reminders are computed in the user's timezone. The server used the container clock, so a UTC host showed an Asia/Manila user the previous day for the first eight hours of every local day: `daysPastDue` was off by one and bills due today read "Due tomorrow". The cron path uses the stored `users.timezone_offset` so reminder emails agree with the app
- **Pay & Edit** prefilled a date one day early for anyone behind UTC; it now reads the calendar date directly off the ISO string

### Safety and performance
- **Pay All now confirms first**, naming the count and total. It previously wrote N real transactions on a single unguarded click, while deleting one category shows a `ConfirmModal`
- Pay All invalidates once per run instead of once per payment. A 23-bill run previously fired roughly a hundred refetches that queued against the payments still in flight
- Terminal actions are idempotent per occurrence. There is no unique constraint on `(scheduled_transaction_id, due_date)`, so a resubmit -- a double click, or a click against a reminder list that has not refetched yet -- wrote a second transaction and paid the same occurrence twice. Each action now returns 409 if the occurrence already has a `PAID`/`SKIPPED` log, checked under the row lock so the guard cannot race
- Pay All awaits the refetch before re-enabling its buttons, so the banner stops offering bills that were just paid
- Failed pay/snooze/skip actions surface a toast. They passed only `onSuccess` and the mutation has no global error handler, so failures were entirely silent

### Banner UI
- The dismiss animation runs again: the component returned `null` outside `AnimatePresence`, so the exit transition never played
- Accessibility: the prev/next arrows were unlabelled buttons wrapping an SVG, the position counter is announced, and the snooze trigger gained `aria-haspopup`, `aria-expanded`, menu roles, and Escape to close

## 2026-08-20 - PWA Install Prompt Fixes

### Install prompt reliability
- **Root cause fix**: Chrome fires `beforeinstallprompt` once, shortly after load, and the only listener lived inside a `useEffect`. On the authenticated shell, hydration often finished after the event fired, and the event never replays, so `canInstall` stayed `false` for the whole session and the banner never appeared. The event is now captured by an inline script in the root layout at parse time and adopted by `useInstallPrompt` via a `bip-ready` event
- The stashed prompt is cleared as soon as it is consumed or the app is installed, since `prompt()` throws if called twice
- Banner now hides when the app is installed from the browser's own menu. `appinstalled` previously left a visible banner on screen
- Installed-PWA detection adds `navigator.standalone`, so iOS before 16.4 no longer shows the "Add to Home Screen" guide inside the installed app

### Layout and robustness
- Install banner no longer paints over the bill reminder. Both were fixed to the same corner (install `4.5rem`/`z-40`, bill `5rem`/`z-20`); the install card now offsets by the bill banner height, which is what `MobileFab` already assumed. Clearance passes as a CSS variable so the `lg:` breakpoint keeps its own base offset
- `localStorage` access is guarded. It throws in embedded webviews and when site data is blocked, and these calls run in effects inside `AppShell`, so an uncaught throw took down the whole authenticated shell for a cosmetic nudge

### Accessibility and access
- Banner is a labelled `region` instead of an `aria-live` status: a live region announced the text but gave screen reader users no route to the buttons inside it. Escape now dismisses it, cooldown included
- New **Install App** row in Profile > Features (`src/components/pwa/install-app-card.tsx`), the way back in after the banner's 14-day dismissal. Handles installed / installable / iOS / unsupported states
- `manifest.ts` pins `id: "/dashboard"` (the current implicit value) so future `start_url` changes cannot orphan existing installs

## 2026-07-28 — Container Liveness Endpoint

### Health Check
- Added `GET /api/health` returning `{ status: "ok" }` for the Coolify/Docker container healthcheck
- Probe is shallow by design: no database and no auth. Every app on this host shares one Postgres instance, so a deep check would mark them all unhealthy during a single database blip and restart the lot at once
- `dynamic = "force-dynamic"` pinned so the probe always executes at request time rather than being statically optimized
- Unaffected by `middleware.ts`, whose matcher covers only page routes
- Coolify config: path `/api/health`, port 3000, interval 30s, timeout 5s, retries 3, start period 40s

## 2026-06-15 — AI Assessment tab (Analytics)

### AI-powered financial assessment
- New **AI Assessment** tab on the Analytics page — Gemini analyzes the selected period's already-computed data and returns a personalized report: Summary + score commentary, **Watch list**, **Cut back** (with est. monthly savings), **Boost savings**, **Ways to earn**, and **Quick actions**
- **Tips from the web** section uses **Gemini Google Search grounding** (localized to the user's currency/region) with linked sources
- **Daily tip** card: a lightweight save/earn nudge, lazily generated once per local day and cached
- **On-demand + cached**: a "Generate / Refresh" button calls the AI; results are cached per period (`granularity:from:to`) so revisits don't re-call. Privacy by construction — prose uses relative/percentage terms; numeric fields respect Hide Amounts
- Report = two parallel Gemini calls (structured data analysis + grounded web tips); reuses `generateContentWithRetry`/retry/fallback from `src/lib/gemini.ts`
- New routes: `GET /api/assessment`, `POST /api/assessment/generate`, `GET /api/assessment/daily-tip`
- New models: `AiAssessment` (cache) + `AiUsageLog` (per-day generation cap, default 10 via `AI_ASSESSMENT_DAILY_LIMIT`); migration `20260615120000_add_ai_assessment`
- Available to all signed-in users for v1; role/feature gating (like receipt scan) is a future option

## 2026-06-15 — Analytics Stats & Health mobile redesign

### Stats (Records & Statistics) tab
- Replaced the uniform 3-box grid with a content-fit layout: **Top Records** now shows Biggest Expense & Income as two featured tiles plus a full-width "Most Expensive Day" banner; Averages, Activity, and Category Insights render as clean **list rows** (icon + label left, value right) with dividers
- Tighter card padding on mobile (`p-4 sm:p-5`); long category/description text truncates gracefully

### Health (Financial Health) tab
- Overall score is now a horizontal **gauge + text hero** on mobile (was a tall centered stack); faint band-colored halo behind the ring gauge
- Sub-scores use a **2-up grid** on mobile (5th spans full width) with a **mini progress bar** (score/100, color-banded) under each score and 2-line clamped descriptions
- Privacy masking, empty-state `—` handling, and tablet/desktop layouts unchanged

## 2026-06-15 — Profile Menu

### Account & Quick-Nav Menu
- Tapping the profile icon now opens a menu instead of navigating straight to `/profile`
- **Mobile**: native-style bottom sheet (drag-to-dismiss) built with the `vaul` library
- **Desktop**: anchored dropdown opening upward from the sidebar profile row (Framer Motion)
- Items: My Profile, Admin (admins only), Hide/Show amounts toggle, Log out; plus Bills & Categories on mobile only (desktop already lists them in the sidebar)
- Hide-amounts toggle flips inline via `usePrivacy()` and keeps the menu open for feedback
- Standalone desktop "Sign Out" button folded into the menu
- Mobile bottom nav: Dashboard / Transactions / Analytics (+ Scan) + a **Profile** tab that opens the sheet — Bills & Categories moved into the menu (desktop sidebar unchanged)
- Profile trigger moved out of the top mobile header (now logo/title only) into the bottom nav tab
- New component: `src/components/profile-menu.tsx`; new dependency: `vaul@1.1.2`

## 2026-04-07 — Financial Health Score (Analytics Phase 4)

### Financial Health Tab
- Added third tab to Analytics page: **Financial Health** with composite score (0-100)
- **SVG ring gauge** with animated fill, color-coded by score label
- **5 weighted sub-scores**: Savings Rate (35%), Expense Trend (25%), Income Stability (15%), Category Diversification (15%), Spending Consistency (10%)
- **Score labels**: Excellent (80-100), Good (60-79), Fair (40-59), Needs Attention (20-39), Critical (0-19)
- **Trend indicators**: comparing current vs previous period (improving/declining/stable/new)
- Savings Rate uses income-to-expense ratio with piecewise linear mapping
- Category Diversification uses normalized Shannon entropy
- Expense Trend and Income Stability compare period-over-period changes
- Server-side `computeHealthScore()` — no extra DB queries, reuses existing computed data
- Null-safe: handles zero income, zero expenses, and no previous period data gracefully
- New types: `HealthTrend`, `HealthSubScore`, `AnalyticsHealthScore`

## 2026-04-07 — Records & Statistics (Analytics Phase 3)

### Records & Statistics Tab
- Added tab navigation to Analytics page (Reports / Records & Statistics)
- **Top Records**: Biggest expense, biggest income, most expensive day with transaction details
- **Averages**: Daily spend, per-expense average, per-income average
- **Activity**: Total transactions, active days ratio, longest spending streak
- **Category Insights**: Most used category, most expensive category, categories used count
- Server-side `computeStatistics()` — single-pass over existing transaction query, no extra DB calls
- Spending streak algorithm: consecutive expense-day tracking with O(D+T) complexity
- Privacy mode support — monetary values hidden, counts/streaks always visible
- Null-safe display with "—" fallback for empty periods
- Staggered Framer Motion entrance animations matching existing design
- New types: `AnalyticsTopRecord`, `AnalyticsStatistics` added to `AnalyticsData` response

## 2026-04-06 — Analytics Page (Phase 1)

### Analytics & Reporting
- Added dedicated Analytics page (`/analytics`) with top-level navigation
- Income & Expenses bar chart with period bucketing (weekly/monthly/yearly)
- Cash Flow area chart showing net flow per period (positive/negative fills) with cumulative trend line
- Category Breakdown donut chart with full ranked list, transaction counts, and icons
- Label Breakdown horizontal bar chart with progress bars and percentage
- Summary cards row: total income, total expenses, net cash flow, transaction count
- Time Range Picker: preset toggles (Weekly/Monthly/Yearly) with navigation arrows, plus Custom date range mode
- Type Filter: segmented control (All/Expenses/Income) filters category and label breakdowns
- Auto-granularity for custom ranges (< 3 months = weekly, < 2 years = monthly, else yearly)
- Empty period buckets rendered for visual continuity
- Privacy mode support — all amounts respect hide-amounts toggle
- Loading skeleton matching full page layout
- Staggered Framer Motion entrance animations
- New API endpoint: `GET /api/analytics` with `granularity`, `from`, `to`, `tz`, `type` params
- Single Prisma query with in-memory aggregation for all chart sections
- React Query hook (`useAnalyticsQuery`) with cache invalidation on transaction mutations
- Mobile-responsive: charts stack vertically, compact nav items

### Navigation
- Added Analytics to desktop sidebar and mobile bottom nav (BarChart3 icon)
- Reduced mobile nav item padding to accommodate 5 items + scan button

## 2026-02-17 — Initial Build

### Project Initialization
- Scaffolded Next.js 15 (App Router) project with TypeScript, Tailwind CSS
- Configured Prisma ORM with PostgreSQL (`User`, `Category`, `Transaction` models)
- Set up NextAuth.js v4 with credentials provider (email/password)
- Created Zod validation schemas for all forms
- Seeded 15 default categories (10 expense, 5 income)

### Authentication
- Built login and register pages with React Hook Form + Zod validation
- Auto sign-in after registration
- Route protection via NextAuth middleware
- JWT session strategy with user ID in token

### App Layout & Design
- Designed "Light & Warm" aesthetic — cream/paper backgrounds, warm browns, amber accents
- Typography: Young Serif (headings) + Outfit (body) from Google Fonts
- Desktop: sidebar navigation with animated active indicator
- Mobile: top header + bottom tab navigation
- Framer Motion animations throughout (page transitions, staggered reveals, layout animations)
- Custom warm scrollbar, grain texture overlays, soft shadows

### Dashboard
- Summary cards: total income, total expenses, running balance
- Monthly trend bar chart (last 6 months) using Recharts
- Spending by category donut chart
- Recent transactions list with category icons
- Month navigator to browse historical data

### Transactions (Full CRUD)
- Add/edit/delete transactions via modal forms
- Category picker with visual grid (icons + colors)
- Type toggle (Income/Expense) that filters available categories
- Search transactions by description or category name
- Filter by type (All/Income/Expenses)
- Month navigation and pagination (15 per page)
- Hover-reveal edit/delete actions
- Delete confirmation modal
- Animated list with AnimatePresence

### Categories (Full CRUD)
- 15 pre-seeded default categories (locked, non-editable)
- Create custom categories with name, type, color, and icon
- Color picker with 15 presets + custom color input
- Icon picker from 20 Lucide icons
- Live preview while creating/editing
- Prevents deletion of categories that have transactions
- Separated sections: "Your Categories" vs "Default Categories"

### API Routes
- `POST /api/register` — User registration with bcrypt hashing
- `GET/POST /api/transactions` — List (with filters/pagination) and create
- `PUT/DELETE /api/transactions/[id]` — Update and delete with ownership check
- `GET/POST /api/categories` — List (defaults + user's custom) and create
- `PUT/DELETE /api/categories/[id]` — Update and delete (custom only)
- `GET /api/dashboard` — Aggregated stats, category breakdown, monthly trends

---

## 2026-02-17 — UX Improvements

### Quick-Add Transaction from Dashboard
- Added "Add Transaction" button in the dashboard header (desktop)
- Added floating action button (FAB) on mobile — amber circle with `+` icon, positioned above bottom nav
- Transaction form opens as a modal directly on the dashboard
- Dashboard stats auto-refresh after adding a transaction
- Empty state CTA also opens the modal instead of redirecting

### Privacy Toggle (Hide Amounts)
- Added `hide_amounts` column to `users` table (persisted in database)
- Created `/api/preferences` route (GET to read, PATCH to toggle)
- Eye/EyeOff toggle button next to "Dashboard" title
- When enabled: summary cards show `₱ ••••••`, transaction amounts show `••••`
- Created shared `PrivacyProvider` context wrapping the app layout
- Both Dashboard and Transactions pages respect the toggle consistently
- Preference persists across logout, login, and different devices

---

## 2026-02-17 — Build Fixes & Deploy Prep

### Bug Fixes
- Fixed parsing error caused by stray character in `dashboard/page.tsx` (`return (a` → `return (`)
- Added `outputFileTracingRoot` to `next.config.ts` to fix workspace root detection issue (Next.js was inferring the wrong root due to a lockfile in the home directory, causing module-not-found errors for API routes)

### Deployment Configuration
- Set `output: "standalone"` in `next.config.ts` for Coolify/Docker deployments
- Added `engines.node >= 20` to `package.json`

### UI Improvement
- Moved privacy toggle (Eye/EyeOff) from the page header to the top-right corner of each summary card (Income, Expenses, Balance) for better contextual placement

---

## 2026-02-18 — Dashboard Enhancements & Landing Page

### Cumulative Running Balance
- Balance card now shows **cumulative running balance** (all-time income − all-time expenses up to end of selected month) instead of monthly-only balance
- Added two `aggregate` queries to the dashboard API, running in parallel with existing queries for zero added latency
- Added `runningBalance` field to `DashboardStats` type
- Income and Expenses cards now show "This month" sublabel; Balance card shows "Running Balance" with "Cumulative" sublabel
- Navigating to future months correctly carries over the balance

### Horizontal Scroll Summary Cards
- Converted summary cards from static grid to **horizontal scroll with snap points** on mobile
- Desktop remains a clean grid layout (`sm:grid-cols-3`)
- Each card snaps into place while swiping — peek of the next card hints at scrollability
- Added `.scrollbar-hide` utility to `globals.css` for clean mobile UX
- Layout is ready to accommodate a 4th card in the future (just add a card and bump to `sm:grid-cols-4`)

### Balance Trend Widget
- New **Balance Trend** area chart showing daily running balance over a 30-day window
- API computes daily balances by deriving prior balance from existing aggregates + walking through window transactions day by day (1 new query added to `Promise.all`)
- Chart component (`BalanceTrendChart`) built with Recharts `AreaChart`:
  - Blue gradient fill (`#3b82f6` → transparent)
  - Dashed horizontal grid lines
  - Abbreviated Y-axis labels (e.g., "193.4K")
  - Date-formatted X-axis ticks (e.g., "2/14")
- Key metrics row above chart:
  - **TODAY** — current balance (last data point)
  - **LAST 30 DAYS** — percentage change badge (green/red/gray)
- Tooltip and amounts respect privacy mode (`hideAmounts`)
- Full-width card placed below the existing 2-column charts row
- Added `BalanceTrendItem` type and `balanceTrend` to `DashboardStats`

### Landing Page (Homepage)
- Built a full **landing page** for non-authenticated users at `/`
- Root page (`page.tsx`) now renders the landing page instead of redirecting to `/login`; authenticated users still redirect to `/dashboard`
- Sections:
  - **Navigation** — fixed frosted glass navbar with logo, Sign In, and Get Started CTA
  - **Hero** — "Your Money, Beautifully Organized" headline with amber accent, dual CTAs, badge pill
  - **Dashboard Preview** — realistic browser-frame mockup with summary cards, bar chart, and transaction rows using real design tokens
  - **Features** — 6-card grid: Smart Dashboard, Category Tracking, Balance Trend, Privacy Mode, Monthly Navigation, Quick Transactions
  - **How It Works** — 3-step numbered flow (Create account → Log transactions → See the bigger picture)
  - **CTA** — final sign-up push with large button
  - **Footer** — copyright and navigation links
- Framer Motion `whileInView` scroll-triggered animations with staggered reveals
- Decorative blur circles in background (consistent with auth layout style)
- Fully responsive: single column on mobile, full grid on desktop

---

## 2026-02-18 — Transaction Form UX & Deploy Optimization

### Transaction Form Improvements
- Amount input now **auto-formats with commas** while typing (e.g., `122000` → `122,000.00`) and formats to 2 decimal places on blur
- Switched amount input to `type="text"` with `inputMode="decimal"` for numeric keyboard on mobile (no alphanumeric keys)
- Changed date picker from `type="date"` to `type="datetime-local"` — users can now pick both date and time
- Updated `formatDateInput` utility to output `YYYY-MM-DDTHH:mm` format (local time)
- Updated `formatDate` display utility to include hour and minute (e.g., "Feb 18, 2026, 2:30 PM")
- Fixed `pattern="[0-9]*"` attribute causing browser validation error ("please match the requested format") on decimal values
- Added `min-w-0` to all form inputs and `overflow-hidden` on the form to prevent horizontal scroll on narrow mobile screens

### Deployment Optimization (Coolify / Nixpacks)
- Added `.dockerignore` to exclude `node_modules`, `.next`, `.git`, and other unnecessary files from build context
- Added `nixpacks.toml` with custom build phases — caches pnpm store, `node_modules/.cache`, and `.next/cache` between deploys
- Start command uses `node .next/standalone/server.js` for lightweight standalone output
- Fixed `pnpm: command not found` error during Nixpacks build — replaced `npm i -g pnpm` with `corepack enable` (built into Node 20)
- Disabled ESLint and TypeScript checking during `next build` (`eslint.ignoreDuringBuilds`, `typescript.ignoreBuildErrors`) — now handled by git hooks instead

### Developer Experience
- Added **husky** git hooks with **lint-staged**:
  - **Pre-commit**: runs ESLint on staged `.ts`/`.tsx` files only (fast)
  - **Pre-push**: runs `pnpm type-check` on full codebase (blocks push on type errors)
- Lint and type-check no longer duplicate during deploy — caught earlier in the dev workflow

### Deployment Bug Fixes
- Fixed **Bad Gateway** after deploy — standalone server defaulted to `127.0.0.1` inside Docker; added `HOSTNAME=0.0.0.0 PORT=3000` to nixpacks start command
- Fixed **broken styles** (404 on all `_next/static/*` assets) — standalone output doesn't include static files; added `cp -r .next/static .next/standalone/.next/static` to build phase
- Removed `cp -r public .next/standalone/public` — project has no `public` folder, causing build failure

### UI Enhancements
- Added **dynamic favicon** matching the app logo (generated via Next.js `icon` route)
- **Reordered summary cards** — Balance first, then Expenses, then Income (previously Income first)
- Fixed **recent transactions** ordering — now sorted by date descending, then creation time descending
- Fixed **datetime-local input** cutout/clipping on mobile Safari

---

## 2026-02-18 — Category Picker & Modal UX Overhaul

### Slide-In Category Picker
- Replaced inline category grid in the transaction form with a **slide-in category picker view**
- Selecting a category type or tapping the category field slides to a dedicated picker screen
- Picker shows all categories for the selected type with icon, color swatch, and name
- Back button slides back to the main form — smooth left/right transition

### Transaction Modal Improvements
- Moved **delete action into the edit transaction modal** — no more hover-reveal delete buttons on transaction rows
- Delete button appears alongside Cancel and Update when editing an existing transaction
- Standardized all modal action buttons with **equal sizing and icon + text labels** for consistency
- Added icons to all modal action buttons across the app (Cancel, Delete, Update, Add, etc.)

---

## 2026-02-20 — Profile Settings Page

### Profile Settings (`/profile`)
- New **Profile Settings** page with two sections: Personal Information and Change Password
- **Desktop layout:** left sidebar tab navigation + right content area with tab switching
- **Mobile layout:** both sections stacked vertically, no tab switching needed
- Personal Information form: edit name, email, and preferred currency (dropdown with 10 common currencies)
- Change Password form: current password verification via bcrypt, new password with confirmation
- Sidebar user info (name + email) updates **instantly** after saving — no page refresh needed

### User Provider Context
- Created `UserProvider` context (same pattern as `PrivacyProvider`) to share reactive user info across components
- `AppShell` reads from `useUser()` context instead of static server props
- Profile page calls `setUser()` after successful save — sidebar re-renders immediately

### Database
- Added `currency` column to `users` table (defaults to `"PHP"`, applied via Prisma migration)

### API Routes
- `GET /api/profile` — returns current user's name, email, currency
- `PATCH /api/profile` — updates name, email, currency with Zod validation and email uniqueness check
- `POST /api/profile/password` — verifies current password, hashes and saves new password

### Navigation
- Sidebar user info block (avatar + name + email) is now clickable — navigates to `/profile`
- Mobile header: added user icon (top-right) linking to `/profile`

---

## 2026-02-20 — Currency & Deployment

### Dynamic Currency Across App
- Currency selected in profile settings now **reflects across all app pages** (dashboard, transactions, charts, forms)
- Added `currency` to `UserProvider` context — fetched from DB in the app layout
- Updated `formatCurrency` utility to accept a dynamic currency code
- Added `getCurrencySymbol` helper for input prefixes and privacy-mode placeholders
- Dashboard summary cards, transaction rows, chart tooltips, and the transaction form all use the user's chosen currency

### Deployment
- Build script now auto-runs `prisma migrate deploy` before `next build` — no manual migration step needed on deploy

---

## 2026-02-21 — Transaction Form Redesign & Quick Categories

### Modal Overhaul
- **Mobile:** modals now render as **bottom sheets** that slide up from the screen edge with a drag handle
- **Drag-to-dismiss:** swipe down >100px or with >300px/s velocity to close
- **Desktop:** centered card with spring scale-up animation and rounded corners
- **Sticky header** with title and close button that stays fixed while content scrolls
- **Grain texture overlay** and backdrop blur on the overlay

### Transaction Form Redesign
- **Hero amount input** — large centered numeric input (48px, Plus Jakarta Sans) with dynamic color coding: green for income, red for expenses
- **Quick category tiles** — top 4 personalized categories shown as a grid above the form; swaps between expense and income sets
- **"More categories..." panel** — slide-in picker for the full category list, with smooth left/right spring animation
- **Date quick-picks** — "Today", "Yesterday", and "Custom" buttons replace the raw datetime input
- **Optional note field** — description marked as "(Optional)" to reduce friction
- **Sticky footer** — Cancel, Delete (edit mode only), and Add/Update buttons pinned to the bottom
- **Plus Jakarta Sans** (`font-display`) used for all currency amounts across the app — dashboard summary cards, transaction rows, date group subtotals, and chart values

### Category Form Improvements
- **Color swatches:** larger presets with checkmark indicator and scale-up on selection
- **Icon grid:** improved layout with live color preview on each icon
- **Live preview box:** real-time mockup showing icon + name + type badge, updates as user edits

### Customizable Quick Category Tiles
- Users can **choose their top 4 quick-access categories** per type (expense and income) from the Categories page
- Preferences saved to `quickExpenseCategories` / `quickIncomeCategories` columns on the User model
- **Order badges** (1–4) show selection order; max 4 enforced with disabled state on overflow
- **Quick Access section** on the Categories page: 4 slots per type with `+` placeholders and an "Edit" button to open the picker
- Transaction form reads quick preferences from `/api/preferences` with fallback to first 4 defaults
- Extended `/api/preferences` route to handle GET/PATCH for quick category prefs

### Database
- Added `quick_expense_categories` and `quick_income_categories` JSON columns to `users` table (Prisma migration)

---

## 2026-02-21 — iOS Safari Modal & Keyboard Fixes

### Modal Keyboard Handling
- Fixed **keyboard pushing modal off-screen** on iOS Safari — modal now tracks the visual viewport and repositions dynamically when the keyboard opens
- Created `useVisualViewport` hook that monitors `window.visualViewport` resize and scroll events in real-time
- **Container pinning** — modal container uses `top: offsetTop` and `height: viewport.height` to stay within the visible area above the keyboard
- **Dynamic max-height** — modal card calculates pixel-based max-height from actual viewport height instead of CSS `90vh` (which doesn't account for the keyboard on iOS)
- **Auto-scroll focused inputs** — when a user taps an input inside a scrollable modal, the input smoothly scrolls into view after a 350ms delay (allows keyboard animation to settle)
- Used `useRef` for `onClose` callback to prevent effect re-runs and preserve original `body.overflow` value on cleanup

### iOS Safari Auto-Zoom Fix
- Disabled iOS Safari's automatic zoom on input focus by setting `maximumScale: 1` in the Next.js viewport config
- Prevents the jarring 100% → 200% zoom that occurs when tapping inputs with font-size < 16px

---

## 2026-02-22 — Receipt Scanning with AI

### Receipt Scanner
- New **Receipt Scanning** feature — capture or upload photos of receipts on mobile, and AI automatically extracts transaction details (amount, date, category, merchant)
- Uses **Google Gemini AI** (`gemini-2.5-flash`) for OCR processing with a structured prompt that returns JSON
- **Mobile bottom nav** gains a "Scan" button (conditional — only visible when the feature is enabled)
- Flow: select photo → compress → upload to API → Gemini extracts data → pre-fills transaction form → user reviews and saves
- All scanned fields (amount, date, category, description) remain fully editable before submission

### Image Compression
- Client-side image compression via **Canvas API** before upload
- Resizes to max 1500px dimension, re-encodes as JPEG at 75% quality
- Reduces typical 4 MB phone photos to ~200–400 KB for faster upload
- Graceful fallback to original file if Canvas API is unavailable

### Feature Toggle
- Receipt scanning is an **opt-in feature** — disabled by default
- New "Features" tab in Profile Settings with a toggle switch for receipt scanning
- Toggle uses optimistic UI (updates instantly, reverts on error)
- Setting persisted per-user in the database (`receipt_scan_enabled` column)

### Scan Receipt Sheet (UI)
- Bottom sheet modal with two options: "Take Photo" (rear camera) and "Upload Image" (gallery)
- Shows scanning spinner while processing
- Displays user-friendly error messages with retry guidance on failure
- Accepted file types: JPEG, PNG, WebP, HEIC/HEIF (max 4 MB)

### API & Integration
- `POST /api/receipts/scan` — accepts receipt image via FormData, validates file type/size, sends to Gemini, returns extracted transaction data
- Gemini prompt dynamically includes user's expense categories for accurate category matching
- Zod validation (`receiptScanResultSchema`) ensures AI response conforms to expected shape
- Falls back to "Other" or first available category if extracted category is invalid
- Extended `/api/preferences` to support `receiptScanEnabled` field (GET/PATCH)
- Added `receiptScanEnabled` to `UserProvider` context and app layout

### Database
- Added `receipt_scan_enabled` boolean column to `users` table (defaults to `false`, Prisma migration)

### Environment Variables
- `GEMINI_API_KEY` — required for Gemini API calls
- `GEMINI_MODEL` — optional, defaults to `gemini-2.5-flash`

---

## 2026-02-23 — Infinite Scroll, Landing Page Redesign & Mobile FABs

### Infinite Scroll with Layout Toggle
- Transaction list now supports **infinite scroll** — auto-loads the next 15 transactions as you scroll down, using an `IntersectionObserver` sentinel
- **Layout preference toggle** in Profile Settings — switch between infinite scroll (default) and traditional pagination
- Preference persisted per-user in database (`transactionLayout` column)
- "Loading more..." spinner during fetch; "All transactions loaded" message when list is exhausted
- Both modes fully support search, type filtering, month navigation, and bulk operations

### Landing Page Redesign
- Completely redesigned the landing page with a modern, elevated aesthetic
- **Dashboard mockup preview** — floating 3D perspective preview with mock summary cards, bar chart, and recent transactions; animated floating category pills on desktop
- **Receipt Scanning showcase** — dedicated section with a phone mockup displaying AI-extracted transaction fields (amount, category, date, merchant) and a 3-step visual flow
- Expanded to an **8-card feature grid** — Smart Dashboard, Receipt Scanning, Category Tracking, Balance Trend, Privacy Mode, Quick Transactions, Monthly Navigation, and Multi-Currency
- Refreshed hero section with animated "Now with AI Receipt Scanning" badge

### Labeled Mobile FABs
- Mobile floating action buttons now display **text labels alongside icons** (e.g., `+ Transaction`, `+ Category`) instead of a plain `+` icon
- Added FABs to **Transactions** and **Categories** pages (previously only on Dashboard)
- Desktop "Add" buttons hidden on mobile (`hidden sm:inline-flex`), replaced by the FAB for a cleaner mobile layout

### Receipt Scanning Improvements
- **Smart category matching** — AI uses explicit rules for common categories (Food & Dining, Transportation, Shopping, Bills, Entertainment, Healthcare) with merchant-aware fallbacks
- **Non-receipt detection** — AI detects non-receipt images (random photos, screenshots) and returns a user-friendly error instead of hallucinated data
- Amount extraction now explicitly includes tax, tips, and service charges (grand total)
- Category fallback to "Other" if the AI-extracted category doesn't match any user category

### Bug Fixes
- Transaction list now **refreshes automatically** when navigating back from receipt scan or dashboard quick-add (timestamp query param triggers re-fetch)
- Fixed chart bar wrapper in landing page requiring explicit height for percentage-based child heights

### Database
- Added `transaction_layout` column to `users` table (defaults to `"infinite"`, Prisma migration)

---

## 2026-02-23 — User Roles & Admin Panel

### User Role System
- Added `UserRole` enum with three tiers: **ADMIN**, **FREE**, **PAID**
- New users default to `FREE` on registration (via Prisma `@default(FREE)`)
- Role flows through the full auth chain: `authorize()` → JWT callback → session callback → `UserProvider` context
- Role available everywhere via `useUser()` hook (`user.role`) and server-side via `getAuthUser()` helper

### Admin Panel (`/admin`)
- New admin-only page for user management — lists all users with name, email, role badge, transaction count, and join date
- One-click **FREE ↔ PAID** role toggle per user (admin cannot change own role or other admins)
- Stats cards showing total, paid, and free user counts
- Note displayed: "Role changes take effect on the user's next login"

### Middleware & Route Protection
- Replaced default `next-auth/middleware` re-export with **custom middleware** using `getToken()` from `next-auth/jwt`
- Unauthenticated users redirected to `/login` with `callbackUrl` preserved
- Non-admin users accessing `/admin` routes silently redirected to `/dashboard`
- Added `/profile/:path*` and `/admin/:path*` to middleware matcher

### Session Helpers
- Added `getAuthUser()` — returns `{ id, role }` or 401 response (existing `getAuthUserId()` unchanged)
- Added `requireAdmin()` — returns `{ id, role }` or 403 if not ADMIN; used by all admin API routes

### Feature Gating
- Receipt scanning toggle in Profile > Features now shows **"Paid only"** label for FREE users (toggle disabled)
- PAID and ADMIN users see the toggle as before
- Mobile scan button in bottom nav gated to `receiptScanEnabled && (PAID || ADMIN)`

### UI Changes
- **Sidebar:** "Admin" nav link with Shield icon — conditionally rendered for ADMIN users only
- **Profile header:** role badge (purple for ADMIN, amber for PAID, neutral for FREE)

### API Routes
- `GET /api/admin/users` — list all users with role, transaction count, and join date (admin only)
- `PATCH /api/admin/users/[id]` — update user role (FREE/PAID only, Zod validated, prevents self-modification and admin-to-admin changes)

### Database
- Added `UserRole` enum (`ADMIN`, `FREE`, `PAID`) and `role` column to `users` table (defaults to `FREE`, Prisma migration)
- Seed script updated to always set `chrisgen19@gmail.com` as ADMIN (idempotent, runs regardless of category seed state)

---

## 2026-02-24 — Admin Scan Settings, Multi-Scan & Monthly Limits

### Admin Scan Settings (`/admin/settings`)
- New **Scan Settings** page under the admin panel with per-role configuration cards (FREE and PAID)
- **Receipt Scanning** toggle — enable/disable receipt scanning per role
- **Max Files Per Upload** — configurable limit (1–50) for batch scan uploads per role
- Optimistic UI updates with inline saving indicators
- Admin layout with sidebar navigation between Users and Scan Settings sub-pages

### Multiple Receipt Scanning (Batch Mode)
- Users can now **select multiple receipt images** at once from the upload picker
- Receipts are scanned **sequentially** via the Gemini API — each result streams into a live **review modal**
- Review modal shows all scanned items with status indicators (scanning spinner, success checkmark, error X)
- Each scanned item displays extracted amount, category, date, and description
- **Edit individual items** — tap any scanned receipt to open it in the transaction form for adjustments
- **Remove items** — delete unwanted receipts from the batch before saving
- **Save All** — batch-saves all successful items as transactions in one action, then redirects to transactions list
- Error handling per item — failed scans show error messages without blocking other items
- Modal blocks closing while scans are in progress or batch save is running

### Monthly Scan Limit
- New `ScanLog` table tracks every successful receipt scan per user with timestamp
- New `monthlyScanLimit` field on `AppSettings` — configurable per role (0 = unlimited)
- **API enforcement** — scan API counts `ScanLog` rows for the current calendar month; returns 403 with usage message when limit is reached
- **Admin settings UI** — new "Monthly Scan Limit" number input (0–1000) per role card alongside existing settings
- **Mobile scan button** — shows usage badge (e.g., "3/10") when a limit is active; button disabled when exhausted
- **Scan sheet** — displays "X scans remaining this month" info line; buttons disabled when no scans remain; multi-upload file count capped to remaining scans
- **Desktop sidebar notices** — amber warning when scans are running low (≤10 remaining); red alert when limit is reached
- ADMIN users are always unlimited regardless of role settings
- Scan count resets naturally at the start of each calendar month (no cron needed)
- `UserProvider` updated to support functional updater pattern for real-time scan count increments

### Bug Fixes
- Fixed duplicate React keys in infinite scroll transaction list when transactions from different months shared the same date group header

### Database
- Added `AppSettings` model with `role` (unique), `receiptScanEnabled`, `maxUploadFiles`, `monthlyScanLimit` fields
- Added `ScanLog` model with `userId` and `createdAt` (indexed on `[userId, createdAt]`)
- Seed script updated with default app settings: FREE (scan disabled, 5 uploads, 5 scans/month), PAID (scan enabled, 10 uploads, unlimited)

### API Routes
- `GET /api/admin/settings` — returns per-role scan settings (admin only)
- `PATCH /api/admin/settings` — update individual role settings with Zod validation (admin only)

---

## 2026-02-24 — Desktop Scan, HEIC Support & Advanced Filters

### Desktop Receipt Scanning
- Added **Scan Receipt** option to desktop "Add Transaction" buttons on Dashboard and Transactions pages
- Dropdown button with animation and keyboard support — appears alongside the existing "Add Transaction" action
- Scan limits enforced with disabled state and remaining count sublabel
- Created `ScanProvider` context to expose scan state from `AppShell` to child pages
- Created reusable `DropdownButton` component with Framer Motion animation and outside-click dismiss

### HEIC/HEIF Support
- Fixed receipt uploads failing on non-Safari browsers for HEIC/HEIF files
- Added `isHeicFile()` helper to bypass canvas compression for HEIC files (which browsers can't render to canvas)
- Added `resolveMimeType()` fallback using file extension when browser reports empty MIME type
- Updated error message to explicitly list HEIC as an accepted format

### Advanced Transaction Filters
- Redesigned filter bar with **category dropdown**, **amount range** (min/max), **sort options** (date, amount — asc/desc), and **server-side search**
- New `TransactionFiltersBar` component with expandable mobile layout, filter chips with clear buttons, and "Clear All" reset
- API now supports `categoryId`, `amountMin`, `amountMax`, `sortBy`, `sortDir`, and `search` query parameters
- Type toggle shows colored active states (green for income, red for expenses, amber for all)

### Bug Fixes
- Fixed category selection resetting when editing individual items in multi-scan review modal
- Fixed admin settings page crashing on fresh deploys — API now auto-creates default FREE/PAID settings via upsert when rows don't exist

---

## 2026-02-25 — Receipt Scan Performance & TanStack Query Caching

### Receipt Scanning Performance
- **Parallel multi-scan processing** — batch uploads now process with a concurrency limit of 3 instead of sequentially, significantly reducing total scan time
- **Parallel DB queries** in scan API route — settings, scan count, and categories fetched via `Promise.all` instead of sequentially
- **Parallel client-side compression** — all selected images compressed in parallel before API calls begin
- **Batch transaction creation** — new `POST /api/transactions/batch` endpoint saves all scanned items in a single request instead of N sequential POSTs

### TanStack Query Integration
- Added **TanStack Query** (`@tanstack/react-query`) for client-side data caching with 5-minute stale time and 30-minute garbage collection
- Created shared `QueryClient` instance (`src/lib/query-client.ts`) wrapped in `Providers` component
- `QueryClientProvider` wraps the entire app alongside `SessionProvider`

### Transaction & Dashboard Caching (`src/hooks/use-transactions.ts`)
- Query key factory for transactions (list, infinite, filters) and dashboard (by month)
- `useTransactionsQuery` — paginated query with placeholder data for smooth page transitions
- `useTransactionsInfiniteQuery` — infinite scroll with automatic next-page detection
- `useDashboardQuery` — monthly dashboard stats
- Mutation hooks (`useCreateTransaction`, `useUpdateTransaction`, `useDeleteTransaction`, `useBulkDeleteTransactions`, `useBatchCreateTransactions`) with **in-place cache updates** — new/edited/deleted transactions update the infinite scroll list immediately without a full refetch
- Dashboard and transaction list caches invalidate automatically after mutations

### Category & Preferences Caching (`src/hooks/use-categories.ts`)
- `useCategoriesQuery(type?)` — cached categories by type (EXPENSE, INCOME, or all)
- `useQuickPreferencesQuery()` — cached quick-access category preferences
- Mutation hooks (`useCreateCategory`, `useUpdateCategory`, `useDeleteCategory`, `useSaveQuickPreferences`) with automatic cache invalidation
- **Transaction form** — categories load instantly on re-open (no shimmer re-flash after first load)
- **Categories page** — all fetch/state replaced with query/mutation hooks; Quick Access section uses cached typed queries

### Files Refactored
- `src/app/(app)/transactions/page.tsx` — replaced manual `fetch`/`useEffect`/`useState` with `useTransactionsInfiniteQuery` + mutation hooks
- `src/app/(app)/dashboard/page.tsx` — replaced manual fetch with `useDashboardQuery` + `useCreateTransaction`
- `src/components/app-shell.tsx` — replaced `router.push` redirects with mutation hooks for transaction creation from scan
- `src/components/transactions/transaction-form.tsx` — replaced category/preferences fetch with cached query hooks
- `src/app/(app)/categories/page.tsx` — replaced all state management with query/mutation hooks

### API Routes
- `POST /api/transactions/batch` — atomic batch creation of multiple transactions (used by multi-scan save-all)

---

## 2026-02-25 — Receipt Itemization & Breakdown Viewer

### Receipt Itemization (Split by Category)
- New **"Itemize" button** in the multi-scan review modal — splits a single receipt into multiple transactions grouped by spending category
- `POST /api/receipts/breakdown` — sends the receipt image to Gemini AI with a category-aware prompt that reads every line item, groups them by category, and returns per-category totals with individual product details
- Each itemized transaction is linked via a shared `receiptGroupId` and tagged with an **"Itemized" badge** in the transaction list
- Itemized transactions store `receiptBreakdown` JSON metadata with the individual line items for that category

### Receipt Breakdown Viewer
- New **`ReceiptBreakdown` component** — collapsible read-only section inside the transaction edit modal showing individual line items from the receipt
- Rendered below the Expense/Income type toggle, only for expense transactions with breakdown data
- Each line item shows the product name (as printed on the receipt) and its price
- Footer row shows the category total
- Starts expanded with a header showing item count and chevron toggle
- Styled with the app's warm/cream aesthetic

### Breakdown API Prompt
- Gemini prompt returns `lineItems` array per category group — each entry contains the exact product name and price from the receipt
- Per-transaction breakdown metadata stores only the line items for that specific category (not all categories)
- Category names resolved from IDs before storing in breakdown metadata

### Database
- Added `receipt_group_id` and `receipt_breakdown` columns to `transactions` table (Prisma migration)

### Files Changed
- `src/app/api/receipts/breakdown/route.ts` — new API route for receipt itemization with category-aware Gemini prompt
- `src/components/transactions/receipt-breakdown.tsx` — new collapsible breakdown viewer component
- `src/components/transactions/transaction-form.tsx` — renders breakdown below type toggle for itemized expenses
- `src/components/app-shell.tsx` — `handleItemize` builds per-transaction breakdown with individual line items
- `src/components/multi-scan-review.tsx` — Itemize button and "Itemized" badge per breakdown child
- `src/lib/validations.ts` — added `lineItems` schema to breakdown result validation
- `src/types/index.ts` — `ReceiptBreakdownMeta` type with `name` + `amount` per item

---

## 2026-02-28 — MCP Server (Claude Desktop Integration)

### MCP Server
- New **Model Context Protocol (MCP) server** for querying budget data directly from Claude Desktop using natural language
- Runs locally via `tsx` over stdio — Claude Desktop starts and stops it automatically, no hosted server needed
- Architecture: `Claude Desktop → (stdio) → MCP Server → Prisma → PostgreSQL`
- User ID passed via `BUDGET_USER_ID` environment variable in the Claude Desktop config (no HTTP session needed)
- Standalone `mcp-server/` package with its own `package.json` and `tsconfig.json` — isolated from the Next.js build

### 8 Read-Only MCP Tools
- **`get_spending_by_category`** — spending grouped by category for a given month, sorted by amount with percentages
- **`get_top_expenses`** — largest individual expense transactions, optionally filtered by month (configurable limit, default 10)
- **`get_monthly_summary`** — income, expenses, and net per month for the last N months (default 6, max 24)
- **`get_spending_trends`** — compare spending between two months, broken down by category with absolute and percentage change
- **`search_transactions`** — search and filter by description, category, amount range, type, and month; supports pagination and sorting
- **`get_budget_overview`** — high-level monthly summary with total income, expenses, net, running balance, and transaction count
- **`get_upcoming_bills`** — scheduled transactions due within N days (default 7, max 90), including overdue detection
- **`get_category_list`** — all categories (default + custom) with type filtering; useful for finding category IDs for other tools

### Shared Query Library
- Created `src/lib/budget-queries.ts` — 8 reusable read-only query functions extracted from existing API routes
- Created `src/lib/budget-query-types.ts` — TypeScript types for all query params and return values
- **Dependency injection** pattern — all functions take `(prisma: PrismaClient, userId: string, params)` so both the MCP server and Next.js app can use their own Prisma instance
- Query logic mirrors existing API routes: `get_spending_by_category` from `api/dashboard` lines 104–126, `get_monthly_summary` from lines 128–151, `search_transactions` from `api/transactions` lines 22–71, `get_upcoming_bills` from `api/bills/upcoming`, `get_category_list` from `api/categories` lines 13–26
- Designed for reuse by a future in-app AI chat feature for end users

### Files Added
- `src/lib/budget-query-types.ts` — shared TypeScript types (params + return values for all 8 queries)
- `src/lib/budget-queries.ts` — shared query functions with Prisma dependency injection
- `mcp-server/package.json` — standalone package with `@modelcontextprotocol/sdk` dependency
- `mcp-server/tsconfig.json` — standalone TypeScript config
- `mcp-server/src/index.ts` — MCP server entry point registering 8 tools with Zod input schemas

### Files Modified
- `.gitignore` — added `mcp-server/node_modules/`
- `tsconfig.json` — excluded `mcp-server/` from root type-checking to avoid conflicts with Next.js build

---

## 2026-02-26 — Dashboard Bug Fixes

### Bug Fixes
- Fixed **non-deterministic ordering** of dashboard recent transactions — added `id` as a final sort tiebreaker to prevent inconsistent results when multiple transactions share the same date and creation time (common with batch-created receipt scan transactions)
- Fixed **dashboard loading skeleton** not matching the actual layout on mobile — summary cards skeleton now uses horizontal scroll with snap points (matching the real cards) instead of a vertical stack; card placeholders include title, subtitle, and eye button; recent transactions section uses correct padding, dividers, and 5 rows (matching the real list)

---

## 2026-02-27 — Scheduled Bills & Reminders

### Bill Management
- New **Bills** page (`/bills`) for managing recurring scheduled transactions (rent, subscriptions, utilities, etc.)
- Full CRUD: create, edit, and deactivate bills with description, amount, category, frequency, and next due date
- **Frequency options** — weekly, biweekly, monthly, quarterly, and yearly recurrence
- Active/inactive toggle — deactivated bills stop triggering reminders but preserve payment history
- Bills page shows upcoming due dates, amounts, and category icons

### Bill Reminders
- **Mobile toast reminders** — floating banner stack on the dashboard showing upcoming and overdue bills
- Overdue bills highlighted in red; upcoming bills in amber
- **One-tap pay** — creates the expense transaction from the bill details and advances the next due date automatically
- Pay & Edit modal allows adjusting amount, date, or description before confirming payment
- Bill reminder provider (`BillReminderProvider`) manages pending reminders across the app

### Bill History
- Each bill tracks payment history via linked transactions
- Expandable history section on each bill card showing past payments with dates and amounts
- History entries link directly to the corresponding transaction (opens edit modal via `?highlight=` param)

### Dashboard Integration
- **Upcoming Bills** widget on the dashboard — shows next 5 due bills with days-until-due badges
- Dashboard FAB repositioned to account for bill reminder stack on mobile

### Database
- Added `Bill` model with `amount`, `description`, `frequency` (enum), `nextDueDate`, `isActive`, `categoryId`, `userId`
- Added `billId` optional field on `Transaction` to link payments to their source bill

### API Routes
- `GET/POST /api/bills` — list and create bills
- `PUT/DELETE /api/bills/[id]` — update and deactivate bills
- `GET /api/bills/upcoming` — upcoming bills within 30 days (used by dashboard and MCP server)
- `POST /api/bills/[id]/pay` — mark bill as paid, create transaction, advance next due date

---

## 2026-02-28 — Email Verification & Password Reset

### Email Verification
- New users receive a **verification email** after registration via Resend
- Verification link with secure token expires after 24 hours
- Unverified users see a banner prompting them to check their email
- `GET /api/email/verify?token=` — validates token and marks email as verified

### Password Reset
- **Forgot password** flow on the login page — enter email to receive a reset link
- Reset token expires after 1 hour
- `POST /api/email/forgot-password` — sends reset link via Resend
- `POST /api/email/reset-password` — validates token and updates password

### Database
- Added `email_verified` timestamp column to `users` table
- Added `VerificationToken` model with `token`, `type` (EMAIL_VERIFY/PASSWORD_RESET), `userId`, `expiresAt`

### Environment Variables
- `RESEND_API_KEY` — required for sending verification and reset emails
- `EMAIL_FROM` — sender address (optional; defaults to `Budget Tracker <noreply@resend.dev>` for development)

---

## 2026-03-01 — Timezone-Aware Dates

### Timezone Support
- All date queries now respect the **user's local timezone offset** for accurate day boundaries and month grouping
- Added `timezoneOffset` to `UserProvider` context — detected from `new Date().getTimezoneOffset()` on the client
- Dashboard, transactions, and bill queries pass the timezone offset to API routes
- API routes use the offset to compute correct date ranges for filtering and grouping
- Added `timezone_offset` column to `users` table

---

## 2026-03-12 — Progressive Web App

### PWA Support
- App is now **installable as a PWA** on Android, iOS, and desktop browsers
- **Serwist** service worker for offline support and smart caching of API responses and static assets
- Web app manifest with app name, icons, theme color, and standalone display mode

### Install Prompt
- **Install prompt banner** — appears after 3 visits for eligible users (not already installed)
- Android: native install prompt via `beforeinstallprompt` event
- iOS Safari: guided instructions ("Tap Share, then Add to Home Screen")
- Dismiss persists for 14 days before re-showing
- Banner height measured via `ResizeObserver` for dynamic FAB positioning

### Standalone Mode
- Safe-area inset handling for notched devices in standalone mode
- Mobile FAB positioning accounts for bottom nav, install banner, and bill reminders

### Caching Strategy
- Runtime caching for API routes (NetworkFirst) and static assets (StaleWhileRevalidate)
- Auth routes excluded from caching to prevent stale session data

### Bug Fixes
- Disabled `SerwistProvider` in development to prevent `sw.js` 404 errors
- Fixed iPadOS detection for install banner (reports as Macintosh with multi-touch)
- Modal scroll position preserved on close to prevent scroll jump

---

## 2026-03-13 — UI Component Refactors & Transaction Auto-Scroll

### Shared MobileFab Component
- Extracted **`MobileFab`** component (`src/components/ui/mobile-fab.tsx`) — shared across dashboard, transactions, categories, and bills pages
- Centralizes install banner clearance logic so positioning updates apply everywhere automatically
- Accepts `label`, `icon`, and `onClick` props
- Fixed categories and bills FABs that were missing install banner awareness (static `bottom-20`)

### Shared ConfirmModal Component
- Extracted **`ConfirmModal`** component (`src/components/ui/confirm-modal.tsx`) — reusable confirmation dialog for delete/deactivate actions
- Replaces ~85 lines of duplicated modal markup across transactions (single + bulk delete), bills (deactivate), and categories (delete)
- Accepts `title`, `message` (ReactNode), `confirmLabel`, `confirmIcon`, `loading`, `onConfirm`, and `onClose` props

### Transaction Auto-Scroll
- After creating or updating a transaction, the list **auto-scrolls to the target row** and highlights it with an amber ring animation for 1.6 seconds
- Dashboard scrolls to the Recent Transactions section after quick-add
- Uses refs (`scrollTargetRef`, `highlightTimeoutRef`) instead of state to avoid re-render race conditions that would kill the highlight timeout
- **Paginated mode support** — `locateTransactionPage()` searches through pages to find and navigate to the one containing the target transaction
- Scroll effect depends only on `sourceTransactions` changes, naturally waiting for query refetches before attempting to scroll
- Stale ref cleanup: ref is cleared if the transaction can't be found (e.g., filtered out)
- `useCreateTransaction` invalidation scoped to `queryKeys.transactions.lists` to avoid unnecessary N-page refetches of infinite scroll caches

---

## 2026-03-17 — Receipt Scan Date Fix & Bill Banner PWA Fix

### Receipt Scan Date Validation
- Added `dateWarning` flag to receipt scan API responses when the AI-extracted date appears suspicious (e.g., POS systems returning wrong year)
- Transaction form and multi-scan review surface a warning to the user instead of silently auto-correcting the date
- Scan API normalizes ISO date strings and relaxes the date clamp threshold to avoid false positives

### Bill Reminder Banner — PWA Safe Area
- Fixed bill reminder banner being partially hidden behind the home indicator on notched iPhones in PWA standalone mode
- Added `env(safe-area-inset-bottom)` to banner positioning, matching the pattern already used by the bottom nav, MobileFab, and install prompt banner

### MobileFab — Auto Bill Reminder Offset
- `MobileFab` now consumes `useBillReminders` directly and automatically offsets itself above the bill reminder banner on **all pages** (transactions, categories, bills)
- Previously only the dashboard passed `extraOffsetRem` — other pages had the FAB overlapping the banner
- Removed the `extraOffsetRem` prop; offset logic is now internal to the component

---

## 2026-04-06 — Label Type Restrictions

### Label Type Configuration
- Labels now have `applicableTo` field: "EXPENSE", "INCOME", or "BOTH" (default for existing labels)
- New "Applies To" toggle section in label create/edit form with expense/income buttons
- Labels page shows colored type badge (Expense/Income) when not "BOTH"

### Type-Aware Filtering
- LabelPicker filters dropdown to only show labels matching the current transaction type
- Schedule auto-labeling (client + server) respects type restrictions across all 5 API paths
- Retroactive "Apply to existing" only processes transactions matching the label's type
- Incompatible labels are automatically stripped when switching transaction type in the form

### Type Change Confirmation
- Narrowing a label's type (e.g. BOTH → EXPENSE) triggers a 409 confirmation when income transactions would lose the label
- Confirmation modal shows affected count before proceeding
- On confirm, stale associations are removed in the same transaction as the update

### User Preference
- New "Default Label Type" setting in Profile > Features (Expense / Income / Both)
- Controls the default `applicableTo` value for newly created labels
- Defaults to "EXPENSE" for new users

---

## 2026-04-05 — Label Schedules (Auto-Tagging)

### Label Schedule Configuration
- Labels can now have time-of-day + day-of-week schedules (e.g. Mon-Fri 9am-5pm)
- Multiple schedules per label supported; first-created label wins on overlap
- Schedule UI in label create/edit form with day toggles + time range inputs
- `LabelSchedule` Prisma model: `days` (int[]), `startTime`/`endTime` (HH:mm strings)

### Client-Side Auto-Labeling
- `useScheduledLabel` hook reactively computes matching label as transaction date changes
- Auto-applied labels show clock icon badge in the label picker
- Users can remove auto-applied labels before saving (e.g. holidays)
- Removal tracking via refs prevents re-adding labels the user explicitly removed

### Server-Side Auto-Labeling
- Shared `schedule-server.ts` helper (`getScheduleContext` + `matchScheduledLabel`) used across all API routes
- `POST /api/transactions` — auto-labels when `labelIds` not provided (hidden-label / scan flows)
- `PUT /api/transactions/[id]` — auto-labels on cold-cache edits, preserves manual labels
- `POST /api/transactions/batch` — auto-labels each transaction in batch (receipt scans)
- `POST /api/bills/[id]/action` (pay) — auto-labels bill payment transactions
- Convention: `labelIds: undefined` = server auto-applies; `labelIds: []` = user opted out

### Retroactive Apply
- `POST /api/labels/[id]/apply` — cursor-paginated endpoint to apply schedule to existing transactions
- "Apply to existing" button on label cards with schedules
- Confirmation modal + success toast with count of applied transactions

---

## 2026-04-06 — UI Fixes & Mobile Layout

### Label Pills Overflow Fix
- Fixed label pills overflowing into the time/amount column on mobile when 3+ labels are present
- Added `overflow-hidden` to the category + labels flex container on both dashboard and transactions pages

### Schedule Auto-Labeling Edit Fix
- Scheduled labels no longer re-apply when editing existing transactions
- Previously, editing a transaction would re-add a scheduled label the user had manually removed (e.g. removing "Work" on a holiday)
- `useScheduledLabel` hook now skips matching entirely in edit mode
- Removed dead edit-seeding logic and unused `getScheduleContext`/`matchScheduledLabel` imports from PUT route

### Snooze Dropdown Fix
- Fixed snooze dropdown on upcoming bills widget being invisible due to `overflow-hidden` on the animation container
- Used framer-motion's `transitionEnd` to switch to `overflow: visible` after the expand animation completes

### Bill Reminder Banner Mobile Layout
- Fixed action buttons (Pay All, Pay, Pay & Edit, Snooze, Skip) overflowing on mobile when multiple reminders are present
- Added `flex-wrap` to actions row so buttons wrap to a second line on narrow screens
- Replaced hardcoded FAB offset (`BILL_REMINDER_STACK_OFFSET_REM = 7`) with dynamic `ResizeObserver` measurement
- Banner reports its actual height to `BillReminderProvider` context via callback ref
- `MobileFab` uses the measured height for proper clearance above the banner
- Added `ResizeObserver` fallback for older browsers (mirrors install banner pattern)

---

## 2026-04-04 — Upcoming Bills Timezone Fix

### Server-Side `daysUntilDue` Computation
- Moved `daysUntilDue` calculation from the dashboard client to the `/api/bills/upcoming` API response
- Previously, the dashboard computed `diffDays` client-side using `new Date()`, which could drift from the server's `isOverdue` flag when the user's local timezone differs from UTC — e.g., showing "In -1d" for a bill the server considers not overdue
- Both `isOverdue` and `daysUntilDue` are now derived from the same server-side `today`, guaranteeing consistency

### Timezone-Aware Upcoming Bills API
- `/api/bills/upcoming` now accepts a `tz` query param (user's `getTimezoneOffset()` in minutes), matching the pattern used by `/api/dashboard`
- "Today" is computed as UTC midnight of the user's local date, so `isOverdue`, `daysUntilDue`, and the 7-day query window are all relative to the user's timezone
- Added `daysUntilDue` field to the `UpcomingBill` type in `use-bills.ts`
- `billKeys.upcoming` query key now includes `tz` so the React Query cache invalidates immediately when the user changes their timezone in profile settings
