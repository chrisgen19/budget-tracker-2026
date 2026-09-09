---
paths:
  - src/lib/telegram
  - src/app/tg
  - src/app/api/tg
  - src/components/telegram
  - src/app/(app)/quick-log
  - src/components/quick-log
  - src/lib/quick-tile-writes.ts
  - src/hooks/use-quick-tiles.ts
  - src/lib/assessment-facts.ts
  - src/lib/gemini.ts
  - src/lib/validations.ts
  - src/components/profile/features-form.tsx
  - src/app/(app)/layout.tsx
  - src/app/api/preferences
  - src/app/api/quick-tiles
  - src/app/api/cron/telegram-prompts
  - src/instrumentation.ts
  - src/middleware.ts
  - src/middleware.test.ts
  - src/lib/protected-paths.ts
  - src/lib/protected-paths.test.ts
  - next.config.ts
  - scripts/telegram-bot.ts
  - scripts/link-telegram-user.ts
  - scripts/seed-telegram-quick-tiles.ts
  - e2e/telegram-mini-app.spec.ts
---

# Telegram

## Telegram bot
`src/lib/telegram/bot.ts` is a personal Telegram bot that logs transactions and answers summary
queries. Gemini only ever *classifies* a message, in `src/lib/telegram/classify.ts`: it is never
given transactions, totals or
balances, and every figure the bot sends comes from an MCP read tool via the same handlers the
slash commands use. A free-text question is routed to one of those handlers, not answered by the
model, because a model holding only category names can only refuse or invent. The command menu is registered with Telegram at startup
(`setMyCommands`), scoped to each allowlisted chat id rather than published to the default scope,
which every stranger who finds the bot can see: a public menu would advertise "this month's
balance" to exactly the people the bot answers with silence. The default scope is cleared
unconditionally, and a username-only allowlist gets no menu at all, since a chat scope needs a
chat id. Every feature is discoverable by typing `/` rather than by remembering a
phrasing, and `/examples` prints working messages to copy. A menu entry that resolves to nothing
is worse than none, so a test asserts every listed command is one the bot handles. The chat
**Menu button** is registered the same way and for the same reason (`setChatMenuButton`, scoped per
chat, default cleared), and opens the Mini App; `/quick` is the typed door to the same grid. Obvious phrasings
(`summary`, `my bills please`) are resolved locally in `src/lib/telegram/commands.ts` before
Gemini is consulted at all: paying a model call to recognise the word "summary" is slow, costs a
request, and fails outright when `GEMINI_API_KEY` is unset, where the slash command still works.
Anything ambiguous is left to the model, since a wrong local guess answers a question the user did
not ask with no sign it misread them. That routing covers specific questions too ("did I pay
meralco this month"). Gemini is given the label and category *names* and picks one;
`search-intent.ts` resolves the name back to an id against the real list, so a hallucinated one
cannot reach the query. A label is preferred over a text search whenever the thing named is one,
because labels are how spending is grouped here and the name usually appears in no description at
all: "Shopee" is a label with transactions, and a description search for it returns nothing. Every
unresolvable name or month is dropped rather than passed through, because a filter the query
cannot satisfy returns zero rows and "no transactions found" reads exactly like a real answer. A
question about a recurring bill goes to `get_bill_history` instead. `classify.ts` uses `classifyConfig()` rather than `receiptScanConfig()`: classification picks one
of eleven action labels from a prompt that already lists them, so the reasoning budget buys
nothing and is paid on the hot path of every free-text message. OCR on a crumpled photo is the
opposite case and keeps the configured level. It also passes `minimalThinkingFor` as
`generateContentWithRetry`'s `thinkingFor`, since the fallback path rebuilds `thinkingConfig`
for whichever model it switches to and would otherwise restore `medium` mid-retry.
`classify.ts` imports `@/lib/gemini` *dynamically*, and exports `GEMINI_ENABLED` read from the
environment rather than from a client: `gemini.ts` constructs `GoogleGenAI` at module scope and
throws without `GEMINI_API_KEY`, so a static import would take the bot down at boot on a
deployment with no key, where it should degrade to shorthand-only logging. It is an **MCP
client**, not a database client: it calls `/api/mcp` with a scoped token,
so it inherits the scope, the write lease, the rate limit and the audit trail rather than going
around them, and it holds no database credentials.

Two entry points share the one definition, the same shape as `mcp-server/`:
- `src/instrumentation.ts` starts it on server boot when `TELEGRAM_BOT_ENABLED=true`, which is how
  it runs in production. Importing it means Next traces it into `.next/standalone`, so the
  container needs neither `tsx` nor `scripts/`
- `scripts/telegram-bot.ts` (`pnpm telegram:bot`) runs it locally

**Every handled update is confirmed immediately.** `confirmProcessed` issues a `getUpdates` at the
advanced offset as soon as a handler returns, rather than waiting for the next poll. Advancing the
local `offset` settles nothing — an update is confirmed only when a *later* poll carries a higher
offset — so a process killed in between leaves its batch for the next container to replay. Doing it
per-update rather than only at shutdown is deliberate: the bot runs inside the Next server, and
Next's own signal handler calls `process.exit(0)` once the HTTP server closes, so a shutdown-time
confirmation is racing that exit. Confirming as we go needs no cooperation from anything and holds
for SIGKILL and an OOM kill as well. `startTelegramBot` also installs SIGTERM/SIGINT handlers, but
that is a courtesy — not finishing a handler halfway — not the guarantee. Writes survive a replay (`create_transactions` is keyed on the
update id) but `scan_receipt` is not idempotent, so a receipt in flight during a deploy was scanned
and charged twice (#165). The stop is checked *between* updates, never inside one: an idle long poll
is aborted, because it runs 20s against Docker's 10s grace period, and a handler in flight is always
allowed to finish.

**Only one poller may exist per bot token.** Telegram answers a second concurrent `getUpdates`
with 409 Conflict, which is why the flag exists: without it every `pnpm dev` would fight the
deployed bot. Never run it locally while it is enabled in production.

Every message is gated by `TELEGRAM_ALLOWED_IDS` (preferred) or `TELEGRAM_ALLOWED_USERNAMES`,
**and** by the chat being private. Authenticating the sender alone was not enough: replies go to
`message.chat.id`, so the owner running `/summary` in a group would have shown their balances to
everyone in it.
With neither set the bot serves nobody and says so at startup, because bot usernames are
searchable and the `t.me` link is public. Denials log the sender's numeric id and reply with
nothing, since a reply would confirm the bot is live and whose it is.

`next.config.ts` ignores the bot module for non-node runtimes: `instrumentation.ts` is compiled
for edge as well (middleware exists), the bot uses `node:https` and `node:dns`, and the
`NEXT_RUNTIME` guard stops it *running* there without stopping webpack tracing it.

## Telegram quick logging
Two things, aimed at two different reasons a routine expense never gets logged. A third, the Mini
App grid, is its own section below; both of these survive it unchanged, because both work with no
webview at all.

**The keyboard** (`src/lib/telegram/quick-keyboard.ts`) — `/keyboard` pins a `ReplyKeyboardMarkup` above the message box, `/keyboard off` removes it, and `/help` brings it along. The trick it rests on: a reply-keyboard button **sends its own label as an ordinary message**, so a button reading `38 fare to office` sends exactly that text, which the shorthand path already parses, categorises and logs. There is no new write path, no callback and no state — the button *is* the message. That is also the constraint, and `quick-keyboard.test.ts` enforces it: every label must be valid shorthand (`<amount> <description>`) and must resolve through the real `matchCategory` to Transportation. One case is pinned separately, because `matchCategory` checks category *names* before keyword hints and both Housing and Home Supplies exist: `fare home (UV)` must not be pulled into either. Only fixed fares get buttons — Grab, TNVS and taxi vary per trip, and a button that then has to ask "how much?" is no faster than typing `250 grab`, which is why `input_field_placeholder` says so and the keyboard never reads as the only way in. The amounts are hardcoded on purpose; making them per-user means a column, an editor and a settings page, which is most of the work this approach exists to avoid.

**The evening prompt** (`src/lib/telegram/daily-prompt.ts` + `/api/cron/telegram-prompts`) — one weekday message asking what was spent, off by default and switched on per user in Profile > Features. `isPromptDue` is "at or past the time", not "inside a 15-minute window": a tick delayed by a slow run, a restart or a deploy would otherwise drop that whole day, and a prompt that never arrives is indistinguishable from a day with nothing to report. The once-a-day guarantee is the `telegram_prompt_logs` unique index instead, claimed before the send and released on failure. The prompt goes **silent** when both a Transportation and a Food & Dining expense already exist in the user's local day, and narrows to whichever is missing — a message that arrives when nothing is missing trains you to ignore it, and an ignored prompt is worth less than none. Its example answers both halves in one message, which `parseShorthandEntries` now splits properly.

`telegram_daily_prompt_time` is validated as a **zero-padded** `HH:mm` and a bad value is a 400, not a coercion. Every time-of-day window here is compared as a string (`schedule-matching.ts` and `isPromptDue` both), and lexicographically `"8:00"` sorts *after* `"20:00"` — so an unpadded 8am is treated as later than any evening and the prompt simply never fires. A silent no-op, not a visible error. The regex is exported as `HH_MM` from `validations.ts` and shared with `labelScheduleSchema` rather than written a third time.

`src/lib/telegram/send.ts` holds the https agent, its `TELEGRAM_API_IP` DNS override, `telegramApi` and `sendMessage`, extracted from `bot.ts` so the cron route can send without importing the poll loop, the MCP client and the Gemini classifier. `src/lib/telegram/env.ts` holds the blank-aware `env` reader both use.

**Several transactions in one message** (`src/lib/telegram/multi-shorthand.ts`) — `250 grab, 180 lunch` writes two rows. The shorthand path used one greedy regex (an amount, then "everything after it is the description"), so the second amount was not rejected but *swallowed* into the first row's description, and the reply reported a clean success (#204). Splitting needs a deliberate separator — a comma, semicolon, newline, or the word "and" *followed by an amount* — never bare whitespace before a number, because a wrongly split row invents a transaction where an unsplit one merely mis-describes it: `1500 internet bill 2026` and `250 grab 2 way` must stay whole. A clause with no amount of its own is not a new entry, which is what keeps `1500 groceries, milk and eggs` together and keeps a trailing `label it work` attached to the entry it follows. Label directives are read **per entry** rather than applied to all of them: a wrong label moves money in `getLabelBreakdown`, so it is not a guess worth making. Parsing is all-or-nothing — one unusable clause sends the whole message to the classifier — since logging half of it would recreate the very failure being fixed. That is why the pattern matches a **bare amount**, not an amount followed by a description: a clause has to be *recognised* before it can be rejected, and while a description was required the `180` in `250 grab, 180` was never seen as a clause at all and fell back into the previous one. For a multi-entry message an uncategorised row falls back to `Other Expense` instead of stepping aside for Gemini, because the classifier returns a *single* transaction and stepping aside would silently discard the rest; `formatCreated` names the category on every row, so it is visible and correctable.

**Scoped to one account.** The prompt belongs to whoever owns `TELEGRAM_MCP_TOKEN` (`src/lib/telegram/prompt-owner.ts` resolves it through `hashMcpToken`), because the bot writes into exactly one budget. Everyone else never sees the toggle in Profile > Features and is never selected by the cron. Derived rather than configured as a `TELEGRAM_PROMPT_USER_ID`, so there is no second value to update when the token is re-minted and no way to point the prompt at one account while the bot writes to another; rotating the token is safe, since the lookup hashes whatever the environment currently holds. A revoked **or expired** token counts as no owner, matching `authenticateMcpRequest`'s own conditions: the bot could not record the reply either way, and expiry is certain rather than hypothetical, since a token carrying `transactions:write` may not choose "Never" and is capped at `MAX_WRITE_TOKEN_EXPIRY_DAYS`. The prompt goes to **one** chat, and refuses with 409 when `TELEGRAM_ALLOWED_IDS` holds more than one numeric id: the allowlist answers who may *talk* to the bot, never whose budget it is, so a second id is somebody else who would be told whether the owner logged a fare today.

## Telegram Mini App

`/tg` is a tile grid inside Telegram: one tap logs a routine expense, a tap on an "ask" tile opens
a numeric pad, and a **Frequent** section offers whatever is actually being logged. Tiles are
per-user rows, edited from inside the app. It supersedes #208 and #209, both specified and then
closed undone, and it exists because `quick-keyboard.ts` stated its own ceiling and every part of
that ceiling became the thing in the way: a reply-keyboard button label must be complete shorthand,
so it can never ask "how much?" -- which is Grab, taxi, and a lunch that is 150 one day and 220 the
next, most of what actually gets spent. **The reply keyboard stays.** It is zero latency and needs
no webview, so nothing regresses when the Mini App is slow or unreachable.

**Identity is `users.telegram_user_id`, not the MCP token's owner.** The bot needs no such link
because it writes through a token already bound to a user; a Mini App cannot use that token,
because the page runs in a browser and a credential shipped to a client is a leaked credential.
Deriving identity from `TELEGRAM_MCP_TOKEN` would couple the Mini App to the bot's write
credential, so rotating the token would silently break it and `mcp_tokens.revoked_at` would come
to mean two things. The column is set by hand (`scripts/link-telegram-user.ts`), which is a
one-off for a deployment with one person; a restored database loses it, so `getTelegramUserId`
writes a server-side line naming that script when an allowlisted id resolves to no account -- the
one denial nobody can otherwise diagnose, since the 401 is deliberately opaque.

**The gate is three independent conditions** (`src/lib/telegram/require-telegram-user.ts`), all
required: the payload is signed by *this* bot and is fresh, the Telegram id is in
`TELEGRAM_ALLOWED_IDS`, and it resolves to a linked account. The allowlist is the operational
switch and the column is the identity; either alone answers half the question, and a link left
behind after an allowlist entry is removed would keep working if only the column were consulted.
Ids only -- `messageIsAllowed` accepts a username as a bootstrapping convenience and there is no
such problem here, so a released @handle claimed by someone else never reaches a write path.
`parseAllowlist` is shared with the bot rather than copied, because a Mini App parsing the list
slightly more loosely would serve somebody the bot refuses to talk to. It returns the app user id
or a `NextResponse`, the exact shape `getAuthUserId` has, so a route body reads identically either
way -- a second calling convention is a second chance to forget the check.

`verifyInitData` (`src/lib/telegram/init-data.ts`) is the whole security boundary and is a pure
function with no Prisma and no environment reads, pinned to a fixed vector. Note the key/message
order Telegram specifies is the reverse of the intuitive reading -- the *constant* `"WebAppData"`
is the HMAC key and the *token* is the message -- and getting it the other way round produces a
stable, plausible digest that never matches anything. The check string is built from **every**
field including ones nothing here reads, since Telegram adds fields over time and signing only the
known ones leaves the rest unauthenticated. `MAX_INIT_DATA_AGE_MS` is 24h rather than the hour
that reads as safer: Telegram does **not** refresh `initData` while the app stays open, so a
window shorter than a plausible session produces 401s the page cannot recover from. It bounds
replay; what bounds *use* is the allowlist and the link, both revocable in a second. A payload
from the future is refused too, with a minute of slack -- it means a clock is wrong somewhere, and
the age check then cannot be trusted.

**No cookie, no second session system.** Telegram re-supplies `initData` on every launch and
revalidating it is two HMACs. A cookie would be a second auth system beside NextAuth with its own
expiry, refresh and revocation questions, and would not survive the third-party iframe anyway,
since NextAuth's cookie is not `SameSite=None`. That is also why `/tg` and `/api/tg` are **absent**
from the middleware matcher: redirecting Telegram's webview to `/login` would strand it.
`src/middleware.test.ts` pins the list so the absence cannot be tidied away as an oversight.

**Writes go through `createTransactionBatch` with `createdVia: TELEGRAM` and no `mcpTokenId`.**
Not through `/api/mcp`: that would mean either a token in browser code or a loopback proxy holding
`TELEGRAM_MCP_TOKEN`, and the proxy would put the Mini App behind `users.mcp_writes_enabled_until`
-- a lease designed to lapse, so tapping a tile would fail whenever it did. The consequence is
that `created_via: TELEGRAM` is ambiguous between the bot and the Mini App, distinguishable only
by `mcp_token_id IS NULL`. **Nobody should later "fix" that null.**

`labelIds` is absent from the write rather than `[]` **when the tile carries no pins**, so
auto-apply schedules run: a tap happens *now*, so a schedule's premise of a real clock holds, which
a backdated receipt's does not. Per-tile pinned labels landed as `TelegramQuickTileLabel` and are
edited from the web app's Quick Log page, not from inside Telegram -- see **Pinned labels** below.
The date is the **server's** clock, never the webview's.

### Tiles as data

`TelegramQuickTile` is a table, not a Json column or a `String[]` of ids. Editing means create,
rename, reorder and delete one at a time, and a JSON array makes each of those a read-modify-write
of the whole list where two edits in flight lose one. A table also gets a real foreign key --
`onDelete: SetNull`, so deleting a category leaves the button working. The `String[]` shape is
what `quickPickIdsSchema` exists to paper over and `scripts/prune-quick-category-ids.ts` exists to
clean up after.

A tile carries `label` and `description` **separately**: the grid is three columns on a phone and
the ledger is read a year later, and "Office" is a good button and a useless description. `amount`
is nullable and NULL *is* the "ask" state -- a separate `kind` enum states the same fact twice and
two statements of one fact can disagree. Nullable rather than 0, because a zero-amount transaction
is a real thing to write by accident and nothing downstream would flag it.

`resolveTileCategory` (`src/lib/telegram/quick-tiles.ts`) is the runtime successor to a
compile-time guarantee: `quick-keyboard.test.ts` could assert a fare resolves to Transportation
because `QUICK_FARES` is an `as const` list, and once tiles are user data the same property has to
be answered at three runtime moments instead -- when a tile is **saved** (so the editor can say
"this will file under Other Expense" first), when the grid is **read** (so a tile whose category
was deleted is visibly degraded rather than degraded on the next tap), and when a tap is
**logged**. One function answers all three, which is what stops the editor's promise and the
write's behaviour drifting apart. The ladder is the shorthand path's: the stored `categoryId` if
it still exists **and** its type still matches, then `matchCategory`, then `findOtherCategory`,
then `null`. The re-check is not padding -- `PUT /api/categories/[id]` lets a custom category's
type be flipped underneath its transactions. Returning `null` rather than `categories[0]` must
stay: the list is defaults-first then alphabetical, which is how every unresolved expense once
landed under **Education**.

`sortOrder` is sparse (`SORT_ORDER_GAP`), so a tile can be moved between two others by picking a
number in between; a full reorder still rewrites them all, which keeps the gaps from closing up.

### Pinned labels

`TelegramQuickTileLabel` pins labels to a button, and a pinned label **wins over the user's
auto-apply schedules** for that tap. That falls straight out of `createTransactionBatch`'s existing
tri-state: `labelIds: undefined` lets schedules run, `[]` is an explicit opt-out, and an explicit
list is both an instruction and an opt-out. A tile with pins sends the list; a tile without one
omits the key entirely -- **never `[]`** -- which is the behaviour every button had before pins
existed. The user named these labels on this button, and a schedule guessing over a named one moves
money in `getLabelBreakdown`, which splits one amount across whatever labels a row carries.

**A label whose `applicableTo` excludes the tile's type is refused at the edit, not filtered at the
write.** `createTransactionBatch` type-filters explicit ids *silently*, so accepting one would show
the label in the editor and then quietly not write it -- the same failure `caption-labels.ts`
reports back as `incompatible` rather than dropping. The refusal runs against the **effective**
row, so a bare `type` flip that leaves an incompatible pin behind is caught even though the patch
names no labels at all.

**But it judges only pins that actually move** -- a named `labelIds`, or a `type` flip that
invalidates the stored set. Judging an unchanged, unnamed set prevents nothing and locks the caller
out of a button that was *already* mismatched, which needs no edit to reach: `PUT /api/labels/[id]`
narrows a label's type underneath every button pinning it. The Mini App's editor sends no
`labelIds` and has no picker, so re-judging there made such a button unrenamable from inside
Telegram with no way to fix it there. Same rule `updateTransactions` and `updateBill` already apply
to their own category/type pair, and for the same reason.

A pin can still stop applying *after* it was saved: `PUT /api/labels/[id]` narrows a label's type
and knows nothing about buttons. So `applies` is recomputed on **every** read in `viewTiles`, the
same rule `resolveTileCategory` follows for the category, and the tap filters on it too rather than
leaving it to the silent filter downstream. The web page renders such a pin struck through; the
Mini App grid omits it from its colour dots. When filtering leaves *no* pins, `labelIds` goes back
to being absent and schedules run again -- which is the honest reading of "this button pins
nothing", not an empty opt-out nobody asked for.

Edited only from the web app. The Mini App's editor deliberately has no label picker: three taps is
its whole premise, and a picker is a screen it does not need.

### The web page

`/quick-log` is the CRUD surface for the same `telegram_quick_tiles` rows the Mini App renders --
one set of buttons, two editors, so one made on a laptop is on the phone's grid on its next launch.
It also logs: the card body is a tap and an overflow menu carries edit, delete and reorder. That
split is what makes it worth visiting rather than a settings screen.

**The rules live in `src/lib/quick-tile-writes.ts`, not in either route.** There are two doors onto
these rows and there always will be -- `/api/tg/*` authenticates a signed `initData` payload,
`/api/quick-tiles/*` a NextAuth session -- and what they may do once inside is identical and not a
short list: the tile cap, the duplicate-label refusal, the effective-row category check, the
conditional write that makes an edit depend on the world it was judged against, the
replay-before-resolve ordering on a tap, and the label rules above. Written twice those drift,
which is exactly what `assess.sql` and `assessment-facts.ts` did to each other within days. Each
function returns a discriminated result and `quickTileStatus` is the one place a `reason` becomes a
status code, so the two clients cannot come to disagree about whether a full grid is a 409 -- which
matters, because both read a 4xx as proof nothing was written.

`createdVia` is **passed** to `logQuickTile` rather than derived: `TELEGRAM` from the Mini App,
`APP` from the web page. Provenance follows the surface the user tapped, not the code path, and a
row written from a laptop must not claim Telegram wrote it. Neither carries an `mcpTokenId`.

The amount prompt is a plain `inputMode="decimal"` field, not the Mini App's custom keypad: that
keypad exists because an OS keyboard resizes Telegram's webview mid-entry, which is not a problem a
browser has, and a second keypad is a second thing to maintain.

`/quick-log` is in `PROTECTED_PAGE_PATHS`. The list is a denylist that fails open, and this page
renders the same buttons, amounts and pinned labels `/tg` does.

### The tap key, and the five bugs it took to get right

`pending-taps.ts` holds one idempotency key per unresolved tap. Every rule in it was a bug first,
and they are recorded because the mechanism reads as trivial and is not -- it is exactly-once
semantics over an unreliable network with the state held on a client that can vanish mid-request.
Whoever touches it next should assume the obvious simplification has already been tried:

- **Keyed by tap, not one key per page.** A page-scoped key was picked up by a tap on a *different*
  button and replayed that row: a success toast naming the previous purchase while the button just
  pressed went unlogged.
- **One entry per unresolved tap, not one at a time.** With a single slot, tapping a second button
  overwrote the first tap's key and settling the second discarded it, so re-pressing the first
  wrote a duplicate of a row that had already committed.
- **The amount is part of the slot.** An "ask" tile logs a different purchase each time, so
  replaying one figure's key under another would write the wrong amount. The consequence is that
  editing a fixed tile's amount orphans its key, which is correct: changing the figure changes the
  intent, and replaying would write a figure the user no longer wants.
- **Claim and release are synchronous and outside React.** Held in state, release ran through
  `setPending` -- and a request can settle *after the page has unmounted*, which tapping a button
  and going straight to Transactions does. The update was discarded, the effect never ran, and the
  settled key stayed in storage; coming back and buying the same thing again replayed the old
  transaction. Two real purchases, one row, "Already logged". A duplicate shows up in the ledger;
  a missing row does not.
- **Reuse is bounded by `PENDING_TAP_TTL_MS`, and the bound is short.** `sessionStorage` is a
  ceiling, not a boundary: a tab lives for days, so without a TTL every future identical press was
  a retry of a long-dead failure and swallowed a real purchase. Five minutes is the span in which
  pressing again is a reaction to an error message. Short on purpose -- past the window a genuine
  retry writes a duplicate, which is visible and deletable, where inside it a genuine purchase is
  silently lost.

### Deliberately not done

Three things automated review keeps raising. They are real mechanisms and settled decisions, not
oversights; the answer is here so they are not relitigated each round.

- **The form PATCHes every field, so a stale modal can overwrite a concurrent edit.** True, and it
  is how *every* form in this app behaves -- `PUT /api/transactions/[id]` posts all five fields on
  every save, and the bills form does the same. What it can lose is a button's configuration:
  visible on the grid, re-editable, no money moved. A fix means an `updatedAt` precondition, which
  is a new field in the patch schema, a new refusal, a 409 story in the UI, and the Mini App
  sending it too or the two editors diverging. Worth doing as one change across transactions,
  bills and tiles when this serves more than one person; not worth doing here alone. Note the
  locked staleness check does **not** cover this: it compares the row against *this request's* own
  read, so it catches concurrent requests, not a stale client.
- **A pinned label can be narrowed between the tap's read and `createTransactionBatch`'s label
  lookup.** True, and the same race exists for every transaction created anywhere in the app and
  always has -- `createTransactionBatch` type-filters explicit ids silently by design. Closing it
  means locking label rows inside the single create path used by the batch route, MCP and the bot:
  a large blast radius for a millisecond window whose worst outcome is one label wrong or missing
  on one transaction, visible and correctable. If it is ever worth doing it is a change to
  `transaction-writes.ts` in its own PR, not a special case for tile taps.
- **An orphaned tap key after an amount edit.** Closed by the TTL rather than by tracking the
  payload: the unreachable entry now expires in minutes instead of living as long as the tab. The
  alternative -- persisting the original payload and *offering* it, the shape `pending-log.ts` uses
  -- is a feature (an "unsent tap: retry or discard?" affordance), and AGENTS.md is already
  explicit that a restored intent must be offered rather than auto-replayed. Worth building only
  if the retry affordance is wanted for its own sake.

### Frequent

Configured tiles answer "what do I spend on every day", which someone has to sit down and decide.
`frequent-tiles.ts` answers it from the ledger and keeps answering it as habits change -- the part
of the grid that needs no maintenance. Pure over injected rows, with the loader in
`frequent-tiles-query.ts`, the split `assessment-facts.ts` uses for the same reason.

- **A derived tile never logs an inferred amount on one tap unless it is stable.** The user may
  assert a fixed amount; the system may never infer one. `amountIsStable` means the modal amount
  covers at least `FREQUENT_STABLE_SHARE` (60%) of its occurrences; below that the tile still
  appears -- the description is still worth not typing -- but the pad opens and asks.
- **The representative amount is the mode**, not the mean or the median. One 3,000 outlier drags a
  60-peso fare; a bimodal commute logged as one description at 38 out and 80 home has a median of
  59, a figure never paid. The mode is literally what the thing usually costs and is always a real
  amount from a real row. Rounded to 2dp before grouping, since `amount` is a `Float` and two rows
  both entered as 38.00 can differ in the last bits and collapse the share.
- **Grouped by `frequentKey`**, which is `foldDescription` — imported from `assessment-facts.ts`
  and never re-implemented, since a second copy of that rule is drift and this needs exactly the
  property it exists for: iOS substitutes U+2019, so one merchant written two ways would fall below
  the threshold twice — **tokenised, in the order written**. A token carrying no letter or digit is
  dropped, so the dash in `UV Express - Office to House` is not a word; tested with `\p{L}`/`\p{N}`
  rather than `a-z0-9`, or `Piñata` would be cut in half and `e-load` would become two words a bare
  `load` then contains.
- **Word order is never sorted away, and two review rounds on #269 are why.** Sorting is the obvious
  way to collapse `uv & jeep` and `jeep & uv`, and both attempts merged a *direction* instead:
  sorting unconditionally merged `Office to House` with `House to Office`, and sorting only across a
  conjunction merged `Office & House fare` with `House & Office fare`. Neither is cosmetic — six 38
  trips out and three 80 trips back become nine rows whose modal amount is 38 at a 67% share,
  clearing `FREQUENT_STABLE_SHARE`, while `description` is the most recent spelling, so the tile
  reads as the *return* trip and one-taps the *outbound* fare. **Commutativity cannot be read off
  the text**: `&` joins two things, and whether their order carries meaning is semantics no token
  test can see, so each guess was breached by a phrasing the previous one had not considered. Do not
  add a third.
- **Nothing was lost by removing it.** On the real ledger the output is identical either way, because
  `containsEitherWay` already suppresses `uv & jeep` and `jeep & uv` under the
  `uv express & jeep fare` that contains both — containment does the work without ever deciding
  whether order carries meaning. The residual gap is that two *bare* order-variants with no
  containing superset each keep a slot, which costs a slot on a grid where the merge cost a fare in
  the ledger. This module already prefers the visible mistake to the silent one.
- **`containsEitherWay` treats equal-sized token sets as never a duplicate.** It compares *sets*,
  and `{office, to, house}` equals `{house, to, office}`, so without this the two directions would
  be collapsed at suppression even with grouping order-aware. Given the keys differ, equal sizes
  mean either the same words in a different order — a direction pair — or two sets neither of which
  can contain the other.
- `UV & Jeep` and `UV and Jeep` still do not merge, since `&` is a separator and `and` survives as
  a token. A real gap, deliberately not closed: dropping `and` as a stopword would also cut `S&R`
  down to two one-letter tokens.
- **`foldDescription` itself must never learn this.** It also drives duplicate detection,
  recurring-charge creep and income concentration, so sorting its tokens would make `Mirea Rent`
  and `Rent Mirea` one charge in the assessment and silently move a financial finding. AGENTS.md
  warns against a second copy of the *same* rule; `frequentKey` is a deliberately different one
  built on top of it, for a surface where a false merge costs a button rather than a number in a
  report.
- **One habit gets one slot, by suppression and never by merging** (#268). After ranking, a tile
  whose word set contains — or is contained by — a higher-ranked tile's loses its slot. Five of six
  slots went to two things before this, and `Pandesal` was pushed off the bottom by a second
  spelling of a button already on the grid, which is why suppression runs *before* the cap: a
  suppressed variant hands its slot to the next real habit instead of leaving a hole. Merging is
  the obvious reading of "deduplicate" and is wrong here — `gsm green` and `gsm green ride` carry
  modes of 231.5 and 247, so a merge must pick between two real amounts, and `description` is
  deliberately the most recent spelling, so a plain trip could end up captioned with the longer
  variant. The mistakes do not cost the same: a wrong suppression loses a button, which is visible
  on the grid and recoverable in the editor, where a wrong merge offers a wrong amount under a
  wrong description and one tap writes it. Suppression also keeps every `count` honest, since an
  absorbed group's occurrences never move to the survivor. Still nothing fuzzy — a set relation,
  no edit distance, no similarity score, no threshold to tune. The accepted cost is that a
  genuinely distinct trip sharing every word is suppressed (`Grab` takes the slot from `Grab to
  airport`), pinned by a test so it is recorded rather than discovered on someone's grid.
- **`excludeKeys` is matched by containment too**, and takes raw descriptions that are folded here
  rather than pre-folded keys. Exact-matching it left a variant sitting in Frequent underneath the
  very tile configured to replace it, so the redundancy survived the one action a user would take
  to fix it. This is the layer that makes the grid self-heal: tapping a tile writes one fixed
  description, so the variants stop accumulating and age out of the 60-day window on their own.
- **Bill payments and receipt-split rows are excluded** in SQL. A "Meralco" tile writing a plain
  transaction with no `bill_id` settles no occurrence, does not advance the cursor, and
  manufactures exactly the finding `findUnlinkedBillPayments` exists to report. Three rows from one
  split receipt are one purchase, and their descriptions are category names nobody re-buys.
- Income is excluded outright: repeating income is salary, and a mis-tap writes a wrong figure
  worth a hundred fares.
- The window is bounded at **both** ends. A lower bound alone is "the last 60 days, plus all of the
  future", and nothing stops a row landing there -- `transactionSchema.date` is
  `z.string().min(1)` with no ceiling. Such a row never ages out of a window whose premise is
  recency, and sorts first under `date: desc` so it eats the row cap ahead of real history.
- `timezoneOffset` comes from `users.timezone_offset`, never `TELEGRAM_TZ_OFFSET`, which describes
  the bot's prompt clock and would be a second source of truth for the same fact.

### The API

`GET /api/tg/bootstrap` is one round trip rather than four, because a webview cold start is the
slow moment: Telegram opens a browser, fetches the page and the SDK, and only then can the app ask
for anything. `POST /api/tg/log` loads the named tile **server-side** rather than trusting the
payload, so a stale or hostile client cannot log a figure that disagrees with the button it came
from -- the rule `settleBill` applies to a fixed bill. It also checks the `clientBatchId` replay
**before** resolving the tile: a replay creates nothing, so it must not be judged on references it
will never use, and a 4xx would make the client drop its idempotency pin and duplicate a committed
row. The reorder route takes the **whole** set of ids rather than a moved id and a position, so
the request is self-describing and two drags in flight cannot be interpreted differently.

### Launch surfaces

Three doors, all built from `src/lib/telegram/mini-app.ts`, because all three fail the same way:
Telegram rejects the **whole** `sendMessage` when a keyboard carries a URL it will not accept, so
every function there returns *nothing* rather than something Telegram might refuse. `miniAppUrl`
is stricter than `appBaseUrl` in exactly one way -- **https only** -- because a `web_app` URL is
framed inside the client and an insecure origin is refused outright, where a plain URL button
accepts one.

- **The chat Menu button** (`setChatMenuButton`, at bot startup) is scoped per allowlisted chat
  with the default scope cleared, the same reasoning `menuRegistrations` applies to the "/" menu:
  the default is what every stranger who finds the bot sees, and a button there opens a page that
  401s them -- worse than the silent denial, since it confirms the bot is live and hands them a
  URL. A null URL **clears** the button rather than leaving it, so a deployment that loses
  `TELEGRAM_APP_URL` cannot keep one pointing at a host it no longer controls.
- **The evening prompt's `web_app` button** is the riskiest thing here. A rejected send makes
  `/api/cron/telegram-prompts` release its claimed `telegram_prompt_logs` row, so the next tick
  fails identically and the prompt disappears **permanently**. `miniAppButtonRow` returns an empty
  list on an unusable URL, leaving one fewer row rather than a hole, so "Nothing today" survives.
  `sendOne`'s plain-text retry is a backstop and not the guard: it drops `reply_markup` entirely,
  so a bad button would cost that button too, and the Markdown with it.
- **`/quick`** sends a `web_app` inline button, and names the cause rather than answering with a
  dead button when it cannot. `miniAppOffer` owns that decision, because `bot.ts` has no test of
  its own and anything decided inline there is decided where nothing can check it. Two refusals,
  and the second is easy to miss: **the Mini App's gate is stricter than the bot's by exactly one
  case.** `messageIsAllowed` accepts a username as a bootstrapping convenience; `getTelegramUserId`
  refuses one outright. So a sender allowlisted only through `TELEGRAM_ALLOWED_USERNAMES` can talk
  to the bot, and handing them a button would open a page that 401s -- a door that resolves to
  nothing, the failure `commands.test.ts` already refuses to let a menu entry have. `/quick` is the
  only surface that can reach it, since the other two iterate numeric ids and skip everything else.
  The allowlist is checked before the URL, so on a deployment where both are wrong the cause
  reported is the one that would still block them after the other was fixed. Its bare phrasing is
  deliberately tight (`quick`, `quick log`): a bare amount still belongs to the shorthand logger,
  and `quick lunch` still reaches the model.

A `web_app` button is only valid in a **private** chat, which holds unconditionally here --
`messageIsAllowed` requires one, and the prompt addresses a numeric id, which in a private chat is
the user's own.

### The page

`/tg` sits **outside** the `(app)` group: that layout redirects to `/login` without a NextAuth
session, and there never is one here. Nothing user-specific is rendered on the server -- there is
no session at that layer, so anything reading the database would be reading it as nobody; every
figure arrives over `/api/tg/*` after the SDK hands the page its credential. Three screens rather
than routes, because Telegram's back button is a single handler and a webview that navigates loses
the SDK's state.

- **The Light and Warm palette is forced; `themeParams` is not mapped.** `tailwind.config.ts` has
  no dark mode and the palette has no dark counterpart, so mapping means inventing a second design
  system for one page, and the realistic outcome is a half-themed page -- the exact failure #209
  warned about. Instead `setHeaderColor`, `setBackgroundColor` and a `MainButton` colour reach the
  chrome CSS cannot, in three calls.
- The amount pad is a **custom keypad**, not `<input type="number">`. No OS keyboard means the
  viewport never resizes mid-entry, which removes the whole class of problems `modal.tsx` solves
  for iOS Safari, and three taps beat a keyboard animation on a screen whose premise is speed.
  Entry is held as the *string* typed, since `"0."` and `"38.0"` are states a number cannot hold.
- Layout uses `viewportStableHeight`, not `viewportHeight`: the latter shrinks when the keyboard
  opens, so a layout pinned to it jumps on every focus.
- `disableVerticalSwipes` matters more than it looks: without it a downward swipe on a grid of
  buttons dismisses the whole app mid-tap.
- SDK handlers (`MainButton`, `BackButton`) are held in refs and registered once. Telegram holds
  the listener by identity and fires it from outside React, so a stale closure reaching the button
  is exactly how a save writes the previous amount.
- `resolved` is reported separately from `inTelegram`, because `telegram-web-app.js` loads on any
  page and installs a `WebApp` whose `initData` is `""`. Gated on the object rather than on
  `resolved`, a plain browser sits on a spinner that never resolves.
- The pending idempotency key outlives the page in `sessionStorage` (there is no `update_id` to
  derive one from, and Telegram can reload the webview at any moment) and a restored one is
  **offered**, never auto-replayed -- auto-replaying writes a row for someone who backed out
  deliberately. It carries a `scope` naming the Telegram account, because `sessionStorage` is
  per-origin and Telegram Desktop and Web let one browser profile hold several accounts.

### Things that bite

- **The service worker.** `/tg` is in `PROTECTED_PAGE_PATHS` (`src/lib/protected-paths.ts`), or it
  falls through to `defaultCache`, which is `NetworkFirst`, and writes a page of someone's
  spending to disk. That list lives outside `sw.ts` because `sw.ts` cannot be imported under jsdom,
  so an omission was previously invisible -- and the list is a **denylist**, the shape that fails
  open. `protected-paths.test.ts` is what makes an omission loud.
- **`frame-ancestors`.** Telegram Desktop and Web iframe a Mini App, and that worked only because
  nothing set a framing header at all. `next.config.ts` now writes the requirement down: `DENY`
  everywhere except `/tg`, which names Telegram's origins via CSP (`X-Frame-Options` has no
  allowlist form). A future global CSP must keep this ordering and must not fold `/tg` into it.
- **Local development needs two things**: an HTTPS tunnel, since Telegram rejects `http://` for a
  `web_app` URL, and a **second BotFather bot**, since only one poller may exist per token. The
  second is also the right isolation -- an `initData` signed by a dev token will not validate
  against production.
- **No new environment variables.** It reuses `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_IDS` and
  `TELEGRAM_APP_URL`.

### What this does not change

The bot keeps writing through `TELEGRAM_MCP_TOKEN` as an MCP client, and `telegramPromptOwnerId`
keeps deriving the evening prompt's owner from that token's hash. Converging the two, and with it
closing the 409 in `/api/cron/telegram-prompts` that exists because nothing maps a Telegram account
to an app user, becomes possible after this and is deliberately left as its own change (#132).

Deliberately out of scope: the **full transaction form** from #209 (the grid answers the routine
case, the form answers the detailed one and is its own change with its own risks), **receipt
capture** (`scan_receipt` is not idempotent and needs the care the bot's path already has), and
**editing or deleting transactions** -- #209 is explicit that the Mini App must not quietly become
the delete surface, and there is still no delete tool for anyone.

## Environment Variables

- `TELEGRAM_BOT_ENABLED`: starts the bot from `src/instrumentation.ts` on server boot. Set it **only** in the deployed environment: Telegram answers a second concurrent `getUpdates` for one bot token with 409 Conflict, so enabling it locally while production runs the bot makes the two fight. Use `pnpm telegram:bot` to run it locally instead, and not at the same time
- `TELEGRAM_BOT_TOKEN`: from @BotFather
- `TELEGRAM_ALLOWED_IDS` / `TELEGRAM_ALLOWED_USERNAMES`: who may message the bot. With neither set it serves nobody. Prefer numeric ids: usernames are weaker, since a released handle can be claimed by someone else. `TELEGRAM_ALLOWED_IDS` also gates the **Mini App** and the chat Menu button, and there **ids only** — a username is a bootstrapping convenience for a chat message and must never reach a write path, and a chat scope needs a chat id in any case. Both parse the list through one `parseAllowlist`, so revoking access in one place revokes it everywhere
- `TELEGRAM_MCP_URL` / `TELEGRAM_MCP_TOKEN`: where the bot writes. The URL is **required and has no default**: it used to fall back to this project's production domain, which is correct for its owner and a trap for a fork or a staging deploy that forgets it, since a write-capable token would then be sent to a host the deployer does not control. The port differs by how it runs: `http://localhost:3111/api/mcp` for `pnpm dev` plus `pnpm telegram:bot`, `http://localhost:3000/api/mcp` inside the deployed container (`next start`), or the public URL when the bot runs on a different machine from the app. Mint the token in Profile > MCP Access with all seven scopes the handlers need: `budget:read`, `transactions:read`, `labels:read`, `bills:read`, `receipts:read`, `receipts:scan` and `transactions:write`. A write-only token fails on every message, since each one reads the category list first, and the probe names anything missing at startup. Give the bot its own token so revoking it does not break another client
- `TELEGRAM_TZ_OFFSET`: **required, no default**. Minutes, `getTimezoneOffset()` convention, and it must match the account's own timezone. It used to fall back to the host's offset, which is UTC in the app container, so "yesterday" silently resolved to the wrong day. Used to resolve relative dates for Gemini and to render the day in `/recent`; every query and write is still resolved server-side against `users.timezone_offset`, so a wrong value cannot move a stored row, only mislabel one before it is written. That it duplicates `users.timezone_offset` at all is the real defect and can drift: see issue #132
- `TELEGRAM_APP_URL`: optional; base URL for the "Edit in app" button on a logged transaction **and** for the Mini App at `/tg`. Falls back to `NEXTAUTH_URL`, which every deployment already sets. With neither usable the button is simply omitted. The two readings differ in one way and it is not cosmetic: `appBaseUrl` accepts `http:`, which a plain URL button takes, while `miniAppUrl` requires **https**, because Telegram frames a Mini App inside the client and refuses an insecure origin. So a local `http://localhost:3000` yields an "Edit in app" button and no Mini App — locally that needs an HTTPS tunnel, there is no way around it
- `TELEGRAM_CURRENCY_SYMBOL`: display only, defaults to the peso sign
- `TELEGRAM_API_IP`: only for a network whose DNS sinkholes Telegram, an address to use for `api.telegram.org` instead of the resolver. Unset everywhere else: Telegram rotates these, so a stale pin breaks all bot traffic even where DNS works
- Blank counts as unset for every `TELEGRAM_` variable, so an empty Coolify field is treated as absent rather than as an empty string. `??` alone did not do that: `TELEGRAM_CURRENCY_SYMBOL=""` rendered every amount with no symbol, and `TELEGRAM_TZ_OFFSET=""` meant UTC, since `Number("")` is a finite 0. For the required variables (`TELEGRAM_MCP_URL`, `TELEGRAM_TZ_OFFSET`) blank now fails startup with a named cause rather than falling back

## Key Patterns

- **Edit in app** (`src/lib/telegram/app-link.ts`) — a logged transaction carries a URL button deep-linking to `/transactions?highlight=<id>`, which opens that row's edit modal. It exists because the bot's own handlers only ever call `create_transactions`, so a typo is fixed in the app rather than by chatting at it. Its **token** is no longer that narrow, and this used to claim otherwise: `update_transactions` shares the `transactions:write` scope the bot already holds, so a leaked bot token could rewrite rows even though no code path here does. Editing was given its own `transactions:edit` scope for exactly that reason and then folded back, because separating them cost a re-mint of every existing token and this deployment has one person holding all of them; splitting it out again is tracked as its own issue. There is still no delete tool for anyone, which is the half of the property that holds unconditionally: a wrong edit is visible in the app and correctable, where a wrong delete is silent. The base URL comes from `TELEGRAM_APP_URL` or `NEXTAUTH_URL` and is never hardcoded — a fork must not be handed a link into someone else's budget — and an unusable one yields no button rather than a broken URL, since Telegram rejects the *whole message* when a keyboard carries an invalid one. It is parsed with `new URL`, not pattern-matched: a prefix test accepts `https://app.example invalid`. Blank counts as unset here too, so an empty `TELEGRAM_APP_URL` falls back to `NEXTAUTH_URL` rather than being selected over it. Belt and braces, `sendOne`'s plain-text retries drop the keyboard entirely — an invalid button fails identically on every attempt, and losing the confirmation of a committed write invites a resend that writes a second row
- **Telegram day ranges** — `classify.ts` extracts `from`/`to` (YYYY-MM-DD) for any period narrower than a month, so "last week" is answered as last week. It used to be told "filtering is only available by month", and a narrower question was widened to its month with the reply saying so. `search-intent.ts` validates both against the calendar (`2026-02-31` is dropped, since `Date.UTC` rolls it to 3 March) and drops a backwards range whole; when the model returns a month *and* a range, the month wins and the range is dropped, because the server refuses the pair and answering wider is survivable where answering narrower is a false negative. `period-label.ts` names the window in the reply from the server's own `period` echo rather than from the filters sent, so a day dropped on the way in is never described as though it had applied
- **Telegram totals come from the database** — `handleSearch` reads `totals` off `search_transactions` instead of summing the rows it fetched. The reply used to hedge ("Total of the 100 most recent") whenever matches exceeded `SEARCH_SUM_LIMIT`, which is a hedge on the one number the question was about. Rows are still fetched wider than shown, but only to count how many carry a second label for the shared-label note. Search and recent both pass `compact: true`: the bot renders no icons or colours
- **Telegram reads the server's calendar day** — row rendering uses each row's `localDate` rather than `localDay(row.date, TZ_OFFSET)`. Bill due dates still use `localDay`: they are date-only values stored at midnight UTC meaning "the 5th", and the server deliberately does not resolve them through a timezone (see `utcDayStart`). This narrows #132 rather than closing it — `TELEGRAM_TZ_OFFSET` no longer decides which day a stored row is shown on, only the prompt's "now" and the month defaults
- **Review buttons** (`src/lib/telegram/callback-data.ts`) — the receipt review carries Save/Discard inline buttons. A press arrives as a `callback_query`, which the poll loop used to drop, and is gated by `callbackIsAllowed` rather than `messageIsAllowed`: the shape differs, and a message with buttons can be forwarded, so what is authenticated is *who tapped it*. `callback_data` carries the photo's `updateId` and the handler refuses a press whose id does not match the pending scan — buttons never expire from chat history, so an old review stays tappable and would otherwise confirm whichever scan is pending now, showing one amount and saving another. Buttons are removed once answered *however* it was answered: `PendingScan.reviewMessageId` holds the review's message id so a typed yes or no clears the keyboard too, which is why `sendMessage` returns the id rather than a boolean. Leaving it live on an answered review meant a later tap reported the receipt as expired — true of the draft, misleading about the receipt, which had been saved. `answerCallbackQuery` is best-effort so a spinner never costs the action, and typing `yes`/`no` still works because corrections need free text anyway
- **Correcting a scan at the review** (`src/lib/telegram/scan-correction.ts`) — a reply to the review that is not yes/no replaces the description and re-shows it, still unsaved. Nothing is re-scanned: the user supplied the words themselves, and `scan_receipt` is not idempotent, so a second read would spend another credit for a field already known. Defined by *exclusion* — a reply is a correction only when it is not a confirmation, not amount-first (the shorthand logger keeps those), and not a command — because a description has no recognisable shape and the fall-through it replaces was deliberate. `revisePendingScan` leaves `updateId` untouched so the corrected save still replays the photo's batch key rather than writing a second row. A draft restored after an **unsettled** write is `frozen` and refuses corrections, for the same reason the web app freezes a pinned row: the retry replays the same key, so if the first write did commit the server returns the original and the edit vanishes. A deterministic refusal — a lapsed write lease is the common one — is raised before anything is written, so that draft stays editable. A reply carrying a label directive amends the *labels* instead of the description — `revisePendingScan` takes a `ScanPatch` rather than a bare string for exactly this, since pasting "label it pickleball" over a correctly-read merchant name was all it could do before. Every directive the parser understood is a label edit — applied, missing, type-mismatched or ambiguous — which is what `namesLabels` answers. Spelling those cases out at the call site got it wrong once per bucket added (`incompatible`, then `ambiguous`), each time sending the reply down the description branch and renaming the draft to the text of the instruction. Whether `rest` is a description is answered by `removedDirective` rather than by whether a label resolved — a bare unmarked directive is reported but deliberately left in place, so `rest` is then the whole reply and writing it back would make "label badminton" the description, while "court fee, label it badminton" really does leave "court fee" behind and used to discard it
- **Label directives** (`src/lib/telegram/caption-labels.ts`) — `label it in pickleball`, `tag as work`, `#groceries`. Parsed locally, never by a model: it has to work with no `GEMINI_API_KEY`, and paying a request to recognise the word "label" is the trade `commands.ts` already refuses. A label is named either by a directive (`label it X`, `#X`) or as a **bare clause of its own** — `category fun, pickleball budget` — since both get written in practice and requiring the keyword meant half of them applied nothing. A bare name counts only when it is an *entire* clause, never a word inside one: `lunch with the pickleball crew` and `Yosh's Pickleball fee` resolve to nothing, which is what keeps a passing mention from tagging a purchase, and removing a clause that holds a name and nothing else takes no description with it. A bare clause that resolves to nothing is silently prose — `category fun` is not a label anybody was denied — and that is the one place a name goes unreported. Matching resolves case-insensitively against the user's real list, longest name first so `Work Lunch` is not cut down to `Work`. Exact wins — inside the resolver, not at each call site, since testing for it separately meant `label it work` and `#work` resolved an exact `Work` while a bare `, work` called it ambiguous against `Work Budget` — and failing that, a **whole-word prefix** matching exactly one label resolves too, because labels are commonly named with a suffix nobody says out loud (`Work Budget`, `Pickleball Budget`) and exact-only answered "you don't have a label called pickleball" for someone who plainly does. Still nothing fuzzy — no edit distance, no similarity — so `work` reaches `Work Budget` but never `Workshop`, and two candidates are reported as ambiguous rather than guessed between. A label name may contain a conjunction or a filler word (`With Mom and Dad Budget`), so the whole clause is tried before the list is split on `and`, and the filler scan stops where a name begins. A bare mention applies nothing: "Pickleball court fee" is a description, and labelling on it would tag "lunch with the pickleball crew" as a game. The two mistakes do not cost the same — a missing label is visible in the review, a wrong one moves money in `getLabelBreakdown`, which splits an amount across whatever labels a row carries. A name matching nothing the user owns is reported back rather than dropped, since a silently dropped label is the bug this exists for and the bot cannot create one. `loadLabels` returns a `LabelLookup` carrying `readable`, because an empty list means two different things and the reply used to pick the wrong one: "you don't have a label called pickleball, create it in the app" is confidently false when nothing could be read, and points at the wrong fix — the cause is a token minted without `labels:read`, not a missing label. Every path that can drop a named label says so, the shorthand and classifier confirmations included (`confirmCreated` takes a `notice`); `formatCreated` already lists what *was* applied from the server's own reply, so the notice carries only what went nowhere. The classifier path also parses the directive locally and merges it with the model's names: `transaction.labels` is something Gemini is asked to fill and is not obliged to, so "spent 350 yesterday, tag it work" could come back as a valid CREATE_TRANSACTION with `labels: null` and lose the instruction silently. The parser is deterministic where the model is not. A name the *model* invented is still dropped in silence, since nobody asked for it; only what the user asked for is reported. `get_label_list` is issued in parallel with `get_category_list` rather than behind a keyword test: a bare name has no keyword to gate on, and the two together cost the wall clock of the one round trip that gate was protecting. The review-correction path fetches only while a scan is actually waiting. A connector is consumed only when a name follows it, or "label it pickleball and Yosh will pay me back" loses the "and", and only an explicit conjunction carries the directive into a name that does not resolve — a comma separates clauses as often as names, so "label it pickleball, category fun" must not report "category fun" as a missing label. Parsing continues *past* a resolved name rather than stopping at the first miss: breaking there made order decide the outcome, so "label it pickleball and badminton" applied Pickleball, said nothing about badminton and left "and badminton" behind as the description, while "label it badminton and pickleball" applied nothing at all. A name is removed from the description only where the text is unambiguously an instruction — a colon, a filler word, or a real label named — so "price tag Nike" may earn a note but never loses "tag Nike" from the description. A label whose `applicable_to` excludes the transaction's type is a third outcome, neither applied nor "missing": `createTransactionBatch` type-filters explicit ids *silently*, so a review promising an income-only label on a receipt showed it and then quietly did not write it, and "create it in the app" is the wrong advice for a label already sitting there

## Database

- `scripts/seed-telegram-quick-tiles.ts` gives one named account the Mini App's starting grid: the three fixed fares `QUICK_FARES` already pins to the reply keyboard, plus three ask-for-an-amount tiles a reply keyboard could never offer. Dry run by default, and like the merge script it is **not** part of `pnpm db:seed` or any build — it writes rows for one named user. It seeds an **empty** grid and does nothing else: per-label deduplication is the obvious alternative and is quietly wrong, since a label is the one field the editor exists to change, so renaming "To office" to "Office" frees the original label and the next run recreates it beside the renamed one
