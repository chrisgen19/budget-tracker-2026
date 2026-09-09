# Budget Tracker

## Project Overview
Personal budget tracker app for managing income and expenses with dashboard analytics.

## Tech Stack
- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Database:** PostgreSQL with Prisma ORM
- **Auth:** NextAuth.js v4 (credentials provider)
- **Forms:** React Hook Form + Zod
- **Data Fetching:** TanStack React Query v5
- **Charts:** Recharts
- **OCR / AI:** Google Gemini (`@google/genai`) — receipt scanning + itemization
- **Email:** Resend — email verification + password reset
- **PWA:** Serwist (`@serwist/next`) — service worker, offline support, install prompt
- **Icons:** Lucide React
- **Animation:** Framer Motion
- **Testing:** Vitest + React Testing Library (jsdom)
- **Pre-commit:** Husky + lint-staged (ESLint, `--max-warnings 0`)

## Project Structure
```
src/
├── app/
│   ├── (auth)/             # Login, Register, Forgot/Reset Password, Email Verify
│   ├── (app)/              # Protected pages:
│   │   ├── dashboard/      # Dashboard with charts + upcoming bills widget
│   │   ├── analytics/      # Analytics page with reports + time range controls
│   │   ├── transactions/   # Transaction list + CRUD
│   │   ├── categories/     # Category management
│   │   ├── bills/          # Recurring bills management
│   │   ├── quick-log/      # Quick Log: CRUD + one-tap logging for the quick-log buttons
│   │   ├── profile/        # User profile + feature settings
│   │   └── admin/          # Admin panel (settings)
│   ├── tg/                 # Telegram Mini App (outside (app): no session, initData instead)
│   └── api/                # REST API routes (including api/tg/ for the Mini App)
├── components/
│   ├── ui/                 # Shared UI: Modal, EmptyState, IconMap, ActionFab, ConfirmModal, Toast, DropdownButton
│   ├── analytics/          # Analytics charts (IncomeExpenses, CashFlow, CategoryBreakdown, LabelBreakdown)
│   ├── dashboard/          # Chart components
│   ├── transactions/       # Transaction form, LabelPicker, ReceiptBreakdown
│   ├── labels/             # LabelForm (with schedule config)
│   ├── categories/         # Category form
│   ├── bills/              # BillForm, BillReminderBanner, BillReminderProvider
│   ├── pwa/                # InstallPromptBanner, OfflineBanner, InstallBannerContext
│   ├── telegram/           # Mini App: TelegramApp shell, TileGrid, AmountSheet, TileEditor
│   ├── quick-log/          # Web editor for the same tiles: QuickTileCard, QuickTileForm, AmountPrompt
│   ├── scan-receipt-sheet.tsx   # Single receipt capture modal
│   ├── multi-scan-review.tsx    # Multi-receipt review + itemize
│   ├── scan-provider.tsx        # Receipt scan state context
│   ├── privacy-provider.tsx     # Hide-amounts state context
│   ├── user-provider.tsx        # Reactive user info context
│   ├── app-shell.tsx            # App chrome (nav, FAB, scan handler)
│   ├── landing-page.tsx         # Public landing page
│   └── providers.tsx            # Root providers wrapper
├── lib/
│   ├── prisma.ts           # Prisma client singleton
│   ├── auth.ts             # NextAuth config
│   ├── gemini.ts           # Gemini AI client
│   ├── email.ts            # Resend email helpers
│   ├── tokens.ts           # Verification/reset token helpers
│   ├── session.ts          # Session utilities
│   ├── bill-utils.ts       # Bill due-date advancement logic
│   ├── quick-tile-writes.ts   # Quick-log button rules, shared by /api/tg/* and /api/quick-tiles/*
│   ├── scan-quota.ts       # Receipt scan credit reservation, refund, and rate limit
│   ├── receipt-guard.ts    # Shared upload validation + permission gate for receipt routes
│   ├── budget-queries.ts   # Shared read-only Prisma query functions (used by app + MCP)
│   ├── budget-query-types.ts  # TypeScript types for budget queries
│   ├── mcp/                # Shared MCP tool definitions, scopes, and bearer token auth
│   ├── telegram/           # Bot, classifier, shorthand, Mini App gate, quick tiles
│   ├── protected-paths.ts  # Page prefixes the service worker must never cache
│   ├── schedule-matching.ts   # Pure schedule-matching utility (shared client/server)
│   ├── schedule-server.ts     # Server-side schedule helpers (Prisma queries + matching)
│   ├── query-client.ts     # TanStack Query client factory
│   ├── utils.ts            # General utilities
│   ├── validations.ts      # Zod schemas
│   └── index.ts            # Re-exports
├── types/                  # TypeScript type definitions
└── mcp-server/             # stdio entry point for the MCP server (local Claude Desktop)
    └── src/index.ts        # Thin wrapper; the 20 tools live in src/lib/mcp/server.ts
```

## Commands
- `pnpm dev` — Start dev server (Turbopack)
- `pnpm build` — Production build (`prisma generate && next build`). **Touches no database.** It used to run `prisma migrate deploy`, and that is the whole of issue #192: `build` is the script every CI provider runs by convention, and a Vercel project connected to this repo built every branch push with a production `DATABASE_URL`, so seven migrations reached production between 28 and 71 seconds after their *branch* commit — before review, before merge, and whether or not the PR was ever merged. Nothing that migrates may live under this name again; `scripts/build-scripts.test.ts` asserts it
- `pnpm build:deploy` — What a deploy runs, and the only script that may migrate: `prisma generate && prisma migrate deploy && tsx scripts/check-migration-drift.ts && next build`. `nixpacks.toml` calls it by name, and nothing else does — that is the fix, since a builder wired up later has no reason to guess this name. The drift check runs **after** `prisma migrate deploy`, never before, so a deploy carrying a revert can still apply it; it fails the build naming any migration applied to the database that this checkout does not contain. `prisma migrate deploy` and `prisma migrate status` both report that state as "up to date" and exit 0, which is how two migrations from an unmerged PR sat on production across four green deploys
- `pnpm lint` — Run ESLint
- `pnpm type-check` — Run TypeScript type checker
- `pnpm test` — Run the test suite once (CI mode)
- `pnpm test:watch` — Run tests in watch mode
- `pnpm db:migrate` — Run Prisma migrations (dev). Refuses a `DATABASE_URL` that is not on this machine unless `ALLOW_REMOTE_DB=1`
- `pnpm db:push` — Push schema changes without migration file. Same non-localhost guard as `db:migrate`
- `pnpm db:seed` — Seed default categories
- `pnpm db:studio` — Open Prisma Studio

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection string
- `NEXTAUTH_SECRET` / `NEXTAUTH_URL` — NextAuth session config
- `GEMINI_API_KEY` — Google Gemini AI for receipt scanning
- `GEMINI_MODEL` — Optional; Gemini model for **every** AI call (receipt scanning, itemization, AI Assessment, Telegram classification). Defaults to `gemini-3.6-flash`. Import it from `src/lib/gemini.ts`; never write a model id at a call site — the Telegram classifier pinned a literal and silently ran two generations behind (#163)
- `GEMINI_FALLBACK_MODEL` — Optional; model retried once when the primary stays overloaded (503) after retries (defaults to `gemini-3.5-flash`, a generation behind the primary on purpose; `""` disables fallback)
- `GEMINI_THINKING_BUDGET` — Optional; thinking budget for **Gemini 2.x** models. `-1` = dynamic thinking (default, best quality), `0` = off (speed mode), `128`-`24576` = fixed token budget
- `GEMINI_THINKING_LEVEL` — Optional; thinking level for **Gemini 3+** models (they use `thinkingLevel`, not `thinkingBudget`): `minimal` (speed mode) | `low` | `medium` (default, best quality) | `high`. This is the knob that applies by default, since the default model is now 3.x. It governs receipt scanning and AI Assessment only: the Telegram classifier is pinned to minimal via `classifyConfig()` and deliberately ignores it, because the two want opposite things and one variable cannot say both
- `GEMINI_TIMEOUT_MS` — Optional; per-attempt request timeout in ms (default `60000`, `0` disables). Timed-out attempts are retried like 503s. Lower it (e.g. `30000`) when running speed mode
- `RESEND_API_KEY` — Email sending (verification + password reset)
- `EMAIL_FROM` — Sender address (optional; defaults to `Budget Tracker <noreply@resend.dev>` if unset). Use a verified Resend domain in production, e.g. `Budget Tracker <noreply@yourdomain.com>`.
- `AUTH_URL` — Optional; used in preview/staging deployments
- `ALLOW_REMOTE_DB` — Local only, and never set it in `.env`: `1` lets `pnpm db:migrate` / `pnpm db:push` run against a database that is not on this machine. The guard was written believing two migrations from the closed PR #187 had been applied straight to production from a dev machine; #192 established that a Vercel preview build did it. It is kept regardless — the accident it prevents is one keystroke away, it is simply not the one that happened — and this is the deliberate way past it, one command at a time (`ALLOW_REMOTE_DB=1 pnpm db:push`). Migrations otherwise reach production only by merging to main and letting Coolify deploy them
- `CRON_SECRET` — Shared secret required by `/api/cron/bill-reminders`. Set in the production (Coolify) environment; a Coolify Scheduled Task reuses the same env var to call the endpoint daily (see **Cron Jobs** below).
- `TELEGRAM_BOT_ENABLED`: starts the bot from `src/instrumentation.ts` on server boot. Set it **only** in the deployed environment: Telegram answers a second concurrent `getUpdates` for one bot token with 409 Conflict, so enabling it locally while production runs the bot makes the two fight. Use `pnpm telegram:bot` to run it locally instead, and not at the same time
- `TELEGRAM_BOT_TOKEN`: from @BotFather
- `TELEGRAM_ALLOWED_IDS` / `TELEGRAM_ALLOWED_USERNAMES`: who may message the bot. With neither set it serves nobody. Prefer numeric ids: usernames are weaker, since a released handle can be claimed by someone else. `TELEGRAM_ALLOWED_IDS` also gates the **Mini App** and the chat Menu button, and there **ids only** — a username is a bootstrapping convenience for a chat message and must never reach a write path, and a chat scope needs a chat id in any case. Both parse the list through one `parseAllowlist`, so revoking access in one place revokes it everywhere
- `TELEGRAM_MCP_URL` / `TELEGRAM_MCP_TOKEN`: where the bot writes. The URL is **required and has no default**: it used to fall back to this project's production domain, which is correct for its owner and a trap for a fork or a staging deploy that forgets it, since a write-capable token would then be sent to a host the deployer does not control. The port differs by how it runs: `http://localhost:3111/api/mcp` for `pnpm dev` plus `pnpm telegram:bot`, `http://localhost:3000/api/mcp` inside the deployed container (`next start`), or the public URL when the bot runs on a different machine from the app. Mint the token in Profile > MCP Access with all seven scopes the handlers need: `budget:read`, `transactions:read`, `labels:read`, `bills:read`, `receipts:read`, `receipts:scan` and `transactions:write`. A write-only token fails on every message, since each one reads the category list first, and the probe names anything missing at startup. Give the bot its own token so revoking it does not break another client
- `TELEGRAM_TZ_OFFSET`: **required, no default**. Minutes, `getTimezoneOffset()` convention, and it must match the account's own timezone. It used to fall back to the host's offset, which is UTC in the app container, so "yesterday" silently resolved to the wrong day. Used to resolve relative dates for Gemini and to render the day in `/recent`; every query and write is still resolved server-side against `users.timezone_offset`, so a wrong value cannot move a stored row, only mislabel one before it is written. That it duplicates `users.timezone_offset` at all is the real defect and can drift: see issue #132
- `TELEGRAM_APP_URL`: optional; base URL for the "Edit in app" button on a logged transaction **and** for the Mini App at `/tg`. Falls back to `NEXTAUTH_URL`, which every deployment already sets. With neither usable the button is simply omitted. The two readings differ in one way and it is not cosmetic: `appBaseUrl` accepts `http:`, which a plain URL button takes, while `miniAppUrl` requires **https**, because Telegram frames a Mini App inside the client and refuses an insecure origin. So a local `http://localhost:3000` yields an "Edit in app" button and no Mini App — locally that needs an HTTPS tunnel, there is no way around it
- `TELEGRAM_CURRENCY_SYMBOL`: display only, defaults to the peso sign
- `TELEGRAM_API_IP`: only for a network whose DNS sinkholes Telegram, an address to use for `api.telegram.org` instead of the resolver. Unset everywhere else: Telegram rotates these, so a stale pin breaks all bot traffic even where DNS works
- Blank counts as unset for every `TELEGRAM_` variable, so an empty Coolify field is treated as absent rather than as an empty string. `??` alone did not do that: `TELEGRAM_CURRENCY_SYMBOL=""` rendered every amount with no symbol, and `TELEGRAM_TZ_OFFSET=""` meant UTC, since `Number("")` is a finite 0. For the required variables (`TELEGRAM_MCP_URL`, `TELEGRAM_TZ_OFFSET`) blank now fails startup with a named cause rather than falling back
- `AI_ASSESSMENT_DAILY_LIMIT` — Optional; max AI Assessment report generations per user per day (default `10`). The grounded report makes 2 Gemini calls per generation; cached reports and the daily tip don't count against it.

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

## Cron Jobs
Production runs on Coolify. Schedules are configured in the Coolify dashboard under **Application > Scheduled Tasks** (not in the repo). Each task runs its command inside the running container, so it can hit the app at `http://localhost:3000` and reuse the container's env vars.

Active tasks:
- **Bill reminders** — daily at `0 21 * * *` UTC (05:00 Asia/Manila); command: `curl -sS -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/bill-reminders`
- **Telegram evening prompt** — every 15 minutes, `*/15 * * * *`; command: `curl -sS -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/telegram-prompts`. The *schedule* is deliberately not in the cron expression: it lives in `users.telegram_daily_prompt_time` and is resolved against `users.timezone_offset`, so this runs far more often than it does anything and the entry never has to change. A fixed UTC time would need `0 12 * * 1-5` for 20:00 Asia/Manila, and the weekday range is the trap — 07:00 Manila on a Monday is 23:00 UTC on the *Sunday*, so a naive `1-5` silently drops a day at one end and adds one at the other

## Database
- `DATABASE_URL` in `.env` points to local PostgreSQL
- Default categories are seeded (18 total: 13 expense, 5 income) from `src/lib/default-categories.ts`.
  The seed checks each one individually, so a category added to that list reaches an already-seeded
  database; it used to skip the whole block whenever any default existed. `@@unique([name, type,
  userId])` does not constrain defaults, since their `userId` is NULL and Postgres treats NULLs as
  distinct, so a partial unique index on `(name, type) WHERE user_id IS NULL` enforces it instead
  (migration `20260828100000`). Prisma cannot express a partial index, so the schema's `@@unique`
  line is not the whole story. The seed's insert treats `P2002` as success, since a concurrent seed
  winning the race produces exactly the row it wanted.
- Promoting a category people already created by hand into a default leaves both rows in place, and
  `GET /api/categories` returns `OR: [{ isDefault: true }, { userId }]`, so both appear with the same
  name. `scripts/merge-custom-category-into-default.ts` repoints transactions, recurring bills and the
  `quick_*_categories` arrays onto the default and deletes the custom row. Dry run by default
- `pnpm db:seed` is **not** part of a deploy. `nixpacks.toml` runs `pnpm build:deploy`, which is
  `prisma generate && prisma migrate deploy && tsx scripts/check-migration-drift.ts && next build`
  and nothing else, so merging a change to the seed list ships the new prompts while the categories
  they route to do not exist yet. Run the seed by hand from a
  Coolify terminal after deploying one. Do not add it to the build command: it would run on every
  deploy, and the merge script below must never run unattended. `tsx` is a devDependency and may be
  absent from the standalone image, so run `merge-custom-category-into-default.ts` locally against
  the production `DATABASE_URL` if the container cannot; inside the container drop `--env-file`,
  since the variables are already set
- Removing a name from `DEFAULT_CATEGORIES` does not delete the row it already created. The leftover
  keeps `isDefault: true`, and `DELETE /api/categories/[id]` filters on `isDefault: false`, so it
  cannot be removed through the app. The seed reports these (`findOrphanedDefaults`) rather than
  repairing them: renaming one preserves its id and its transactions, but also relabels real spending
- `scripts/seed-telegram-quick-tiles.ts` gives one named account the Mini App's starting grid: the three fixed fares `QUICK_FARES` already pins to the reply keyboard, plus three ask-for-an-amount tiles a reply keyboard could never offer. Dry run by default, and like the merge script it is **not** part of `pnpm db:seed` or any build — it writes rows for one named user. It seeds an **empty** grid and does nothing else: per-label deduplication is the obvious alternative and is quietly wrong, since a label is the one field the editor exists to change, so renaming "To office" to "Office" frees the original label and the next run recreates it beside the renamed one
- Users can create custom categories on top of defaults
- Key models: `User`, `Category`, `Transaction`, `ScheduledTransaction` (recurring bills; `@@map("scheduled_transactions")` — there is no `Bill` model), `ScheduledTransactionLog` (per-occurrence PAID/SKIPPED/SNOOZED), `BillEmailLog`, `Label`, `LabelSchedule`, `TransactionLabel`, `BillLabel`, `VerificationToken`, `ScanLog`, `AiAssessment`, `AiUsageLog`, `McpToken`, `AppSettings`, `TelegramPromptLog`, `TelegramQuickTile`, `TelegramQuickTileLabel`
- Notable columns: `users.hide_amounts`, `users.timezone_offset`, `users.telegram_user_id` (the Mini App's identity half; set by hand with `scripts/link-telegram-user.ts`, so a restored database loses it), `users.email_verified`, `users.default_label_type`, `transactions.receipt_group_id`, `transactions.receipt_breakdown`, `transactions.bill_id`, `transactions.client_batch_id`, `transactions.created_via`, `transactions.mcp_token_id`, `transactions.updated_via`, `transactions.updated_by_mcp_token_id`, `users.mcp_writes_enabled_until`, `mcp_tokens.source`
- `Label.applicable_to` restricts labels to "EXPENSE", "INCOME", or "BOTH" (default); filters LabelPicker, schedule auto-labeling, and retroactive apply
- `LabelSchedule` stores per-label auto-apply rules: `days` (int[]), `startTime`/`endTime` (HH:mm), linked to `Label` via `labelId`

## Testing
- **Vitest + React Testing Library**, jsdom environment. Config in `vitest.config.mts`, global setup in `vitest.setup.ts` (RTL cleanup, and the `matchMedia`/`scrollTo` stubs jsdom lacks)
- **Node floor**: CI and production both run Node 20 (`nixpacks.toml`), so test dependencies have to admit it. `jsdom` stays on 29.x and `@testing-library/jest-dom` is not installed at all — both 30.x and 7.x floor at Node 22. CI installs with `--engine-strict` so a dependency that excludes the Node version fails at install with a named cause, rather than crashing later inside a test worker
- Tests are colocated: `src/**/*.test.ts(x)`, plus `scripts/**/*.test.ts` for the pure helpers there (the `.env` parser, the connection-string host check, the Prisma error classifier). Nothing imports them, so they stay out of the Next.js bundle. The `scripts/` tests declare `@vitest-environment node`, since they run under `tsx` in Node; `vitest.setup.ts` is DOM-only and guards on `typeof window` so it is a no-op for them
- Import test globals explicitly (`import { describe, it, expect } from "vitest"`) rather than enabling `globals`
- A test should fail if you revert the fix it covers. When adding one for a bug, confirm that before committing
- `scripts/verify-scan-quota.ts` and `scripts/verify-mcp-token-auth.ts` remain separate: they need a real PostgreSQL database (advisory locks, row locks, transaction isolation, timestamp marshalling) that jsdom cannot provide. Run them directly with `pnpm exec tsx`. `verify-mcp-token-auth.ts` needs a **non-UTC** database timezone and fails loudly on a UTC one: the regression its rate-limit checks cover only appears when the session zone is not UTC, so a green run against UTC would prove nothing
- `scripts/verify-token-delete.ts` proves that deleting an MCP token removes the credential and leaves the transactions it wrote untouched. The property worth pinning is the absence of a cascade: `transactions.mcp_token_id` is deliberately not a foreign key, and a schema change that made one would delete a user's transactions during a tidy-up with no unit test noticing
- `scripts/verify-receipt-scan.ts` drives `scan_receipt` over the real endpoint with a real Gemini call, and checks the scan-credit accounting: a refused call reserves nothing, a non-receipt is refunded but keeps its `FAILED` row for the rate limit, and a usable scan spends exactly one credit and writes no transaction. It creates and deletes its own throwaway user, so it never touches yours. Pass `RECEIPT=/path/to/receipt.jpg` to also exercise a successful scan; without it the non-receipt path still covers the whole pipeline. It found two bugs no unit test did, so run it after touching the scan path
- `scripts/verify-mcp-periods.ts` drives the stdio MCP server against a real database and checks the period work end to end: that `to` includes its whole local day, that `localDate` disagrees with the UTC slice for rows made late in the evening, that `totals` describe every match rather than the returned page, that a contradictory or impossible window is refused rather than half-applied, and that the four range-taking aggregate tools all agree on the same figure. Unit tests stub Prisma, so none of them would catch a `groupBy` that silently returns the wrong shape. Run it with `BUDGET_USER_ID=<id> DATABASE_URL=<url> pnpm exec tsx scripts/verify-mcp-periods.ts`
- `scripts/verify-telegram-periods.ts` makes a **real Gemini call** per phrasing to check that the classifier prompt actually yields `from`/`to` for a period narrower than a month. A stubbed model proves nothing about a prompt, which is the whole thing under test here. Run with `pnpm exec tsx --env-file=.env scripts/verify-telegram-periods.ts`. Note "last week" resolves to the previous calendar week, not the trailing seven days
- `scripts/assess.ts` prints the full financial assessment for a human or a model to read — coverage, headline and runway, bills, trends, recurring spend, data quality, income concentration and what changed. It reproduces every figure the `finance-assess` skill's old `assess.sql` produced — verified line by line against it — and the skill now runs it; the SQL was deleted in #227. It makes no AI call: `EMAIL=… MONTHS=12 pnpm exec tsx --env-file=.env scripts/assess.ts`
- `scripts/verify-ai-assessment.ts` drives the **whole** generation -- real database, real Gemini call -- and asserts the written half actually used the measured one: the new sections are populated when the facts have something in them, no raw currency reaches prose, a missed bill is named, and an excluded month is named. Each assertion is written to be *failable*: the currency check matches a bare `14,126` and a trailing `1,500 PHP`, not only a leading `₱`, since the model is handed bare numbers and told the currency separately; and the excluded month is matched by its own name rather than by words like "gap" or "logging", which appear in nearly every report and made the check unfailable. Both rules live in `scripts/assessment-prose.ts` -- import-safe, no Prisma client at module scope -- and are unit-tested in `scripts/assessment-prose.test.ts`, since a live Gemini run exercises them only against whatever that one report happened to say. It exists because `assessmentReportSchema` defaults every section, so a prompt the model mishandles degrades to empty arrays rather than throwing: "the model had nothing to say" and "the prompt is broken" are indistinguishable without this. Spends two Gemini calls and writes no `AiUsageLog` row: `pnpm exec tsx --env-file=.env scripts/verify-ai-assessment.ts`
- `scripts/verify-assessment-facts.ts` drives `collectAssessmentFacts` against a real database and prints what the AI Assessment would be told. Read-only, and it picks the busiest user unless `BUDGET_USER_ID` is set: `pnpm exec tsx --env-file=.env scripts/verify-assessment-facts.ts`. The unit tests feed the pure functions hand-built rows, so none of them would notice a `select` that omits a field or an offset applied twice -- three real bugs came out of one run of this
- `scripts/verify-transaction-update.ts` drives `update_transactions` over the real `/api/mcp` route against a real database, and checks the half no stubbed test can: that `updated_via` and `updated_by_mcp_token_id` land on the row while `created_via` survives, that an edit moving nothing leaves the existing trail alone, that `transaction_labels` rows are *replaced* rather than appended, that a refused batch left every row untouched, and that a create-only token cannot see the tool at all. It also covers the concurrency half of #233, which needs two connections: that a `transaction_labels` insert from a path taking **no** lock still waits on the row lock (the FK's `FOR KEY SHARE` conflicting with `FOR UPDATE`, which is what makes weakening it to `FOR NO KEY UPDATE` a silent regression), and that a label added *during* an edit survives it. That last one is the issue's own scenario and is deliberately shaped to be failable: timing alone proves nothing, since `transaction.update` takes its own row lock and a build reading before the transaction waits at the write and looks identical from outside. What separates them is which snapshot the preserved-label set comes from, so the row carries an EXPENSE-only label and the edit flips it to INCOME with no `labelIds` -- which forces the delete-then-create path, the only one that can lose somebody else's label. Confirmed to fail against the pre-fix code. Needs a dev server: `pnpm dev -p 3111` then `BASE_URL=http://localhost:3111 pnpm exec tsx --env-file=.env scripts/verify-transaction-update.ts`
- `scripts/verify-mcp-bill-writes.ts` drives `pay_bill`, `create_bill`, `update_bill` and `create_label` over the real `/api/mcp` route against a real database. Unit tests stub Prisma, so they prove the rules and nothing about the storage: this checks that a payment lands carrying `bill_id` (the failure that made a bill paid over MCP worse than one not logged at all), that `next_due_date` actually moves on the row and a second call against the same occurrence is refused rather than paying the month twice, that a `SKIPPED` month can be corrected by `pay_existing` and cannot by `pay`, that a claimed payment carries `updated_via`/`updated_by_mcp_token_id` naming the token while its `created_via` survives (#256), that a schedule running past its `end_date` deactivates the bill, and that neither a `bills:read` nor a `transactions:write` token can see any of the write tools. Needs a dev server: `pnpm dev -p 3111` then `BASE_URL=http://localhost:3111 pnpm exec tsx --env-file=.env scripts/verify-mcp-bill-writes.ts`
- `scripts/verify-label-removal-stamps.ts` proves the audit stamp on the two label-**removal** branches follows what the delete really removed (#251). A stubbed Prisma can assert the route reads its own result, and `route.test.ts` does; what it cannot show is that the result *differs* from the plan under a real concurrent commit, which is the whole claim. It reproduces the race through the real HTTP route rather than around it: another connection holds `FOR UPDATE` on the link row, the route's `DELETE ... RETURNING` blocks on it, the link is deleted and committed underneath, and the route must then report `updated: 0` and leave the MCP trail alone. Deterministic rather than timing-lucky -- the release waits until the route is provably blocked (`pg_locks`, `NOT granted`), the shape `verify-batch-idempotency.ts` uses, because sleeping instead lets the delete win the race and the check passes against the pre-fix code too. Confirmed to fail against it: pre-fix the route answers `updated: 1` with `changedLinks: 0` in the same response and stamps `APP` over `MCP`. Also covers the owner join, and that a row losing two labels is one edited row. Needs a dev server: `pnpm dev -p 3111` then `BASE_URL=http://localhost:3111 pnpm exec tsx --env-file=.env scripts/verify-label-removal-stamps.ts`
- `src/lib/quick-tile-writes.test.ts` covers the shared quick-log button rules with Prisma and `createTransactionBatch` both stubbed, which is the only way to assert the *argument* a tap makes: that a pinned tile sends `labelIds` and an unpinned one omits the key **entirely**. An `[]` there would silently disable schedules and look identical in every response, so the assertion is `not.toHaveProperty("labelIds")` rather than a value check. `src/app/api/quick-tiles/route.test.ts` covers only what the route layer owns — the session gate, the reason-to-status mapping, and that a replay is answered before the tile is resolved
- `scripts/verify-telegram-miniapp.ts` drives the real `/api/tg/*` routes over HTTP against a real database. Unit tests stub Prisma, so they prove the rules and nothing about the storage or the gate: this checks that a signed `initData` authenticates over a real request, that a tap writes a row carrying `created_via = TELEGRAM` with `mcp_token_id` NULL, that a replayed `clientBatchId` returns the original and writes nothing, and that the label schedules a stubbed `createTransactionBatch` can never exercise really do run. That last part is where the pinned-label rules are actually proved: `labelIds: undefined` versus an explicit list is a distinction that lives *inside* the function every unit test stubs, so only a real write can show that a pin suppresses a schedule, that a pin narrowed after it was saved is dropped, and that with no pins left the schedule runs again. It creates and deletes its own throwaway user. Like the other verify scripts pointed at a `BASE_URL`, it refuses to send a credential over cleartext to anything but this machine — what travels here is a valid `initData`, replayable for its whole freshness window. Needs a dev server, and the test id `999000999` in **both** environments — the server reads the allowlist to answer the request and the script reads it to refuse early with a useful message: `TELEGRAM_ALLOWED_IDS="<yours>,999000999" pnpm dev -p 3111` then `BASE_URL=http://localhost:3111 TELEGRAM_ALLOWED_IDS="<yours>,999000999" pnpm exec tsx --env-file=.env scripts/verify-telegram-miniapp.ts`
- `e2e/telegram-mini-app.spec.ts` (Playwright, `pnpm test:e2e`) drives the Mini App as a real page in a real browser. A Telegram webview cannot be automated but the page in it can: `window.Telegram` is stubbed with a **genuinely signed** `initData` and everything below it is real. It signs from Telegram's published algorithm rather than by calling `verifyInitData`, so a green run means the server agrees with the spec rather than with itself. The allowlist is read by the process serving the request, so the test id has to be in the **server's** environment: `TELEGRAM_ALLOWED_IDS="<yours>,999000999" pnpm dev -p 3311` then `E2E_BASE_URL=http://localhost:3311 pnpm exec playwright test e2e/telegram-mini-app.spec.ts`
- `scripts/verify-mcp-endpoint.ts` drives the real `/api/mcp` route with the SDK's own HTTP client against a dev server: `pnpm dev -p 3111` then `BASE_URL=http://localhost:3111 pnpm exec tsx scripts/verify-mcp-endpoint.ts`

## Key Patterns
- **PrivacyProvider** (`src/components/privacy-provider.tsx`) — shared hide-amounts state across all app pages, persisted in DB via `/api/preferences`
- **UserProvider** (`src/components/user-provider.tsx`) — reactive user info (name, email, currency, receiptScanEnabled, timezoneOffset) shared across components
- **ScanProvider** (`src/components/scan-provider.tsx`) — receipt capture state (captured images, scan results, multi-scan queue)
- **BillReminderProvider** (`src/components/bills/bill-reminder-provider.tsx`) — manages upcoming/overdue bill banners across the app
- **App layout** (`src/app/(app)/layout.tsx`) wraps pages with `Providers > PrivacyProvider > AppShell`
- **ActionFab** (`src/components/ui/action-fab.tsx`) — the floating create button on dashboard, transactions, bills, categories and labels, at *every* width. It was `sm:hidden`, which left desktop with only the page-header button: that scrolls away, so adding a transaction from the bottom of a long list meant scrolling back to the top. Two breakpoints are in play and they deliberately differ. **Visibility** switches at `sm`, mirroring the header button's own gate: below it the FAB rests in place and ducks out of the way while the page scrolls, above it the header button is on screen at the top, so the FAB stays hidden until the page has scrolled past `REVEAL_SCROLL_PX`. **Geometry** switches at `lg`, which is where `MobileTabBar` (`lg:hidden`) stops occupying the bottom of the viewport — a tablet reveals on scroll but still has a nav to clear. Visibility is React state, since "scrolled past" is not expressible as a media query; the offset is CSS custom properties the `lg:` variant switches between, the same way both bottom banners do it. `isDesktop` starts `null` and the button renders hidden *without a transition* until the mount effect resolves it, so the server and first client render agree and desktop never flashes a button at the top of the page only to fade it back out. `disabled` tracks the hidden state and `pointer-events-none` goes on the wrapper, because an invisible button still wins the hit test and would swallow clicks meant for the page beneath it. An optional `items` opens the same `DropdownMenu` as the header dropdown (`placement="top"`, since a bottom-anchored trigger has no room below it) and is **ignored below `sm`**, where the tab bar already carries scan; dashboard and transactions pass the one array to both so the two menus cannot drift. `<main>` reserves matching bottom clearance at both breakpoints (`getFabContentClearance`/`…Desktop` in `bottom-overlay-clearance.ts`), or the last row of a list sits under the button
- **ConfirmModal** (`src/components/ui/confirm-modal.tsx`) — reusable delete/deactivate confirmation dialog
- **Modal** (`src/components/ui/modal.tsx`) — uses `visualViewport` API for keyboard-aware positioning on iOS Safari
- **Receipt scanning** is opt-in per user — toggled in Profile Settings > Features; uses Gemini AI for OCR and per-category itemization
- **Unacknowledged saves** — a failed batch save is classified by whether anything could have been written. A 4xx is raised before the route opens a transaction, so nothing was: the queue is free to be corrected and resubmitted as a new intent. A 5xx or a lost response is *unknown*, so the rows are pinned, frozen in the review, and the retry replays them under the same key. Editing a frozen row would be discarded by the replay, so the UI does not offer it
- **Idempotent batch save** — `POST /api/transactions/batch` accepts a `clientBatchId`. A batch that commits but whose response is lost is indistinguishable from one that never ran, and the multi-scan review invites a retry, which would post every receipt again. The key is held client-side across a failure so the retry replays, and cleared once a save lands. Serialised with a `pg_advisory_xact_lock` on the key so a double submit cannot race the existence check. Verified by `scripts/verify-batch-idempotency.ts`, which drives the real HTTP route against a dev server (`BASE_URL=http://localhost:3111 pnpm exec tsx scripts/verify-batch-idempotency.ts`)
- **Request body ceilings** (`src/lib/request-size.ts`) — `MAX_BATCH_TRANSACTIONS` bounds rows, not their size, and every row may carry a `receiptBreakdown`: 200 rows x `MAX_BREAKDOWN_LINE_ITEMS` (150) x a 255-char name is a schema-legal ~8.6 MB body, which `request.json()` materialises, zod-parses and writes to JSONB *inside* the transaction holding the advisory lock for up to 60s — on a VPS sharing one Postgres with every other app on it (#138). All three verbs of `/api/transactions/batch` now refuse over `MAX_BATCH_BODY_BYTES` (5 MB) with a 413. Two mechanisms, neither redundant: `overBodySizeLimit` reads `content-length`, which is only a *claim* — absent on a chunked request, and simply omitted by `new Request(url, {body})` — and earns its place by refusing an honest client before a byte is buffered; `readJsonWithinLimit` is what actually enforces, counting bytes as it reads and cancelling the stream at the limit. It coalesces into one growing buffer rather than keeping a list of chunks, because a byte ceiling does not bound *allocations*: a stream yields one object per HTTP chunk and the sender picks that size, so a 4 MB body sliced into 64-byte chunks arrives as 65,536 live `Uint8Array`s (measured 36 MB of heap against 16 MB coalesced), and a real chunked request written one byte at a time was confirmed to reach `request.body` as one 1-byte chunk each. This is not a hazard metering introduced — undici's own `readAllBytes` behind `request.json()` does `bytes.push(chunk)` then `Buffer.concat` with no ceiling at all — it is the shape being improved on, and coalescing also halves peak memory in the ordinary case. `checkBodySize` is the multipart wrapper over the first, and stays header-only because `request.formData()` offers no metered read. Three things settled here: 5 MB sits ~2.5x above anything the app can produce (50 receipts, ≤ `MAX_BREAKDOWN_GROUPS` rows each, real names nearer 40 chars than 255), because a 413 on a legitimate save is a dead end — there is no UI to split a batch and the scan credits are already spent, which is the very failure #137 raised the item cap to prevent. **The ceiling must never be lowered casually**: the refusal is a 4xx, which the client reads as proof nothing was written (`BatchSaveError("no")`), so it drops the idempotency pin and unfreezes the rows — a body accepted on the first attempt and refused on its retry would let a corrected resubmit duplicate a committed batch. And unlike the schema rejection it cannot be routed through `rejectUnlessAlreadySaved`, because reading `clientBatchId` means reading the body, which is the thing being refused; a constant ceiling makes that moot, a shrinking one does not. DELETE and PATCH are already byte-bounded by `boundedTransactionIdsSchema` and guard nothing today — they carry it because #138 was never a missing limit but a guard one route forgot to call, and a sibling verb left out is how that recurs. `POST /api/mcp` now has its own ceiling, and it is deliberately a *different* number (#245): the SDK transport reads the body with a bare `await req.json()` and caps nothing, and the body is materialised **before** any tool schema is consulted, so scope narrows nothing — a read-only token reached the same unbounded read. `MAX_MCP_BODY_BYTES` is derived as `MAX_BASE64_LENGTH + 2 MB` rather than copied, because `scan_receipt` legitimately carries a base64 image of up to 5.33 MB and the batch route's 5 MB would refuse every scan over MCP. Metering uses the transport's own documented `parsedBody` option, so no `Request` is reconstructed; the cost is that the size check now precedes the transport's `Accept`/`Content-Type` validation, which is the right order for a ceiling. Note the MCP tools do *not* share the batch route's payload shape — `create_transactions` declares no `receiptBreakdown` and zod strips it
- **Receipt year repair** (`src/lib/receipt-date.ts`): `checkReceiptDate` normally warns about a suspicious year without touching it, but overrides one readable case — when the OCR year disagrees with the photo's while the month and day match it *exactly*. That signature is a misread digit, not an old receipt, since reading a different date wrong almost never lands on the photo's month and day; it was seen in production as `08/26/2026` read back as `2023-08-26`. A repair always sets `dateWarning` and reports `repairedFromYear`, which the review renders as "year corrected from 2023" and `scan_receipt` states in prose, because an inference the user cannot see is one they cannot undo. Deliberately narrow: "same month" or "within a few days" would start rewriting dates that were read correctly. Note this is the one place a *readable* receipt date is influenced by the photo date, narrowing the rule below
- **Photo capture dates** (`src/lib/exif-date.ts`): `readPhotoTakenAt` pulls EXIF `DateTimeOriginal` out of JPEG/HEIC bytes with no dependency, since the tag is fixed-width ASCII inside a standard TIFF block that both formats embed. The Telegram bot has no `File.lastModified` to read, so an unreadable receipt date used to fall back to *today*, putting a receipt photographed days earlier on the day it was uploaded. EXIF timestamps carry no timezone by specification, which is exactly the offset-less shape `resolveTransactionDate` wants; appending a `Z` would claim UTC. It survives only when the image is sent as a **file**, since Telegram re-encodes photos and strips metadata. Used whole rather than as a bare date, so the timestamp is real and label schedules can run against it instead of an invented clock
- **Edit in app** (`src/lib/telegram/app-link.ts`) — a logged transaction carries a URL button deep-linking to `/transactions?highlight=<id>`, which opens that row's edit modal. It exists because the bot's own handlers only ever call `create_transactions`, so a typo is fixed in the app rather than by chatting at it. Its **token** is no longer that narrow, and this used to claim otherwise: `update_transactions` shares the `transactions:write` scope the bot already holds, so a leaked bot token could rewrite rows even though no code path here does. Editing was given its own `transactions:edit` scope for exactly that reason and then folded back, because separating them cost a re-mint of every existing token and this deployment has one person holding all of them; splitting it out again is tracked as its own issue. There is still no delete tool for anyone, which is the half of the property that holds unconditionally: a wrong edit is visible in the app and correctable, where a wrong delete is silent. The base URL comes from `TELEGRAM_APP_URL` or `NEXTAUTH_URL` and is never hardcoded — a fork must not be handed a link into someone else's budget — and an unusable one yields no button rather than a broken URL, since Telegram rejects the *whole message* when a keyboard carries an invalid one. It is parsed with `new URL`, not pattern-matched: a prefix test accepts `https://app.example invalid`. Blank counts as unset here too, so an empty `TELEGRAM_APP_URL` falls back to `NEXTAUTH_URL` rather than being selected over it. Belt and braces, `sendOne`'s plain-text retries drop the keyboard entirely — an invalid button fails identically on every attempt, and losing the confirmation of a committed write invites a resend that writes a second row
- **Telegram day ranges** — `classify.ts` extracts `from`/`to` (YYYY-MM-DD) for any period narrower than a month, so "last week" is answered as last week. It used to be told "filtering is only available by month", and a narrower question was widened to its month with the reply saying so. `search-intent.ts` validates both against the calendar (`2026-02-31` is dropped, since `Date.UTC` rolls it to 3 March) and drops a backwards range whole; when the model returns a month *and* a range, the month wins and the range is dropped, because the server refuses the pair and answering wider is survivable where answering narrower is a false negative. `period-label.ts` names the window in the reply from the server's own `period` echo rather than from the filters sent, so a day dropped on the way in is never described as though it had applied
- **Telegram totals come from the database** — `handleSearch` reads `totals` off `search_transactions` instead of summing the rows it fetched. The reply used to hedge ("Total of the 100 most recent") whenever matches exceeded `SEARCH_SUM_LIMIT`, which is a hedge on the one number the question was about. Rows are still fetched wider than shown, but only to count how many carry a second label for the shared-label note. Search and recent both pass `compact: true`: the bot renders no icons or colours
- **Telegram reads the server's calendar day** — row rendering uses each row's `localDate` rather than `localDay(row.date, TZ_OFFSET)`. Bill due dates still use `localDay`: they are date-only values stored at midnight UTC meaning "the 5th", and the server deliberately does not resolve them through a timezone (see `utcDayStart`). This narrows #132 rather than closing it — `TELEGRAM_TZ_OFFSET` no longer decides which day a stored row is shown on, only the prompt's "now" and the month defaults
- **Review buttons** (`src/lib/telegram/callback-data.ts`) — the receipt review carries Save/Discard inline buttons. A press arrives as a `callback_query`, which the poll loop used to drop, and is gated by `callbackIsAllowed` rather than `messageIsAllowed`: the shape differs, and a message with buttons can be forwarded, so what is authenticated is *who tapped it*. `callback_data` carries the photo's `updateId` and the handler refuses a press whose id does not match the pending scan — buttons never expire from chat history, so an old review stays tappable and would otherwise confirm whichever scan is pending now, showing one amount and saving another. Buttons are removed once answered *however* it was answered: `PendingScan.reviewMessageId` holds the review's message id so a typed yes or no clears the keyboard too, which is why `sendMessage` returns the id rather than a boolean. Leaving it live on an answered review meant a later tap reported the receipt as expired — true of the draft, misleading about the receipt, which had been saved. `answerCallbackQuery` is best-effort so a spinner never costs the action, and typing `yes`/`no` still works because corrections need free text anyway
- **Correcting a scan at the review** (`src/lib/telegram/scan-correction.ts`) — a reply to the review that is not yes/no replaces the description and re-shows it, still unsaved. Nothing is re-scanned: the user supplied the words themselves, and `scan_receipt` is not idempotent, so a second read would spend another credit for a field already known. Defined by *exclusion* — a reply is a correction only when it is not a confirmation, not amount-first (the shorthand logger keeps those), and not a command — because a description has no recognisable shape and the fall-through it replaces was deliberate. `revisePendingScan` leaves `updateId` untouched so the corrected save still replays the photo's batch key rather than writing a second row. A draft restored after an **unsettled** write is `frozen` and refuses corrections, for the same reason the web app freezes a pinned row: the retry replays the same key, so if the first write did commit the server returns the original and the edit vanishes. A deterministic refusal — a lapsed write lease is the common one — is raised before anything is written, so that draft stays editable. A reply carrying a label directive amends the *labels* instead of the description — `revisePendingScan` takes a `ScanPatch` rather than a bare string for exactly this, since pasting "label it pickleball" over a correctly-read merchant name was all it could do before. Every directive the parser understood is a label edit — applied, missing, type-mismatched or ambiguous — which is what `namesLabels` answers. Spelling those cases out at the call site got it wrong once per bucket added (`incompatible`, then `ambiguous`), each time sending the reply down the description branch and renaming the draft to the text of the instruction. Whether `rest` is a description is answered by `removedDirective` rather than by whether a label resolved — a bare unmarked directive is reported but deliberately left in place, so `rest` is then the whole reply and writing it back would make "label badminton" the description, while "court fee, label it badminton" really does leave "court fee" behind and used to discard it
- **Receipt captions** — free text sent with a photo reaches `scanReceipt` as a `caption` and is quoted into the prompt as a *hint*, capped at `MAX_CAPTION_CHARS`. Deliberately not applied afterwards as a description override: "here you go" is an ordinary thing to send with a photo, and pasting it over a correctly-read merchant name is worse than ignoring it, whereas the model can weigh it against what it reads. It is also the only route by which the caption can reach `categoryId`, which is the field OCR most often gets wrong and which a post-hoc description swap could never help. The receipt wins on conflict, and the prompt tells the model to read `amount` and `date` from the image alone. That is a steer, not a guarantee — prose cannot bind a model, and a caption naming a figure could in principle be echoed into `amount`. What actually protects those two fields is the confirmation step, which receipt scanning has always required for precisely this reason: OCR on a crumpled phone photo is where a wrong amount comes from, so nothing is written until the user has seen it. The caption sits *below* the category rules and above only the response format, so it cannot appear to re-scope the rules it must not override. The Telegram review says "I used your caption as a hint" when one was sent, on the same principle as the repaired receipt year: an inference the user cannot see is one they cannot undo. "The receipt wins" is scoped to what the receipt actually *prints* — the amount, the date, and a merchant it names. A wallet transfer prints an account holder and a reference number and nothing about the purchase, so there the caption is the only description that exists and the user's own wording is kept, place names the image cannot corroborate included: `Tiendesitas Yosh's Pickleball fee` came back as `Yosh's Pickleball fee`, which is a row nobody can place a month later. The prompt also says an instruction inside a caption ("category fun") is not description text and that removing one must not take the purchase with it

- **Label directives** (`src/lib/telegram/caption-labels.ts`) — `label it in pickleball`, `tag as work`, `#groceries`. Parsed locally, never by a model: it has to work with no `GEMINI_API_KEY`, and paying a request to recognise the word "label" is the trade `commands.ts` already refuses. A label is named either by a directive (`label it X`, `#X`) or as a **bare clause of its own** — `category fun, pickleball budget` — since both get written in practice and requiring the keyword meant half of them applied nothing. A bare name counts only when it is an *entire* clause, never a word inside one: `lunch with the pickleball crew` and `Yosh's Pickleball fee` resolve to nothing, which is what keeps a passing mention from tagging a purchase, and removing a clause that holds a name and nothing else takes no description with it. A bare clause that resolves to nothing is silently prose — `category fun` is not a label anybody was denied — and that is the one place a name goes unreported. Matching resolves case-insensitively against the user's real list, longest name first so `Work Lunch` is not cut down to `Work`. Exact wins — inside the resolver, not at each call site, since testing for it separately meant `label it work` and `#work` resolved an exact `Work` while a bare `, work` called it ambiguous against `Work Budget` — and failing that, a **whole-word prefix** matching exactly one label resolves too, because labels are commonly named with a suffix nobody says out loud (`Work Budget`, `Pickleball Budget`) and exact-only answered "you don't have a label called pickleball" for someone who plainly does. Still nothing fuzzy — no edit distance, no similarity — so `work` reaches `Work Budget` but never `Workshop`, and two candidates are reported as ambiguous rather than guessed between. A label name may contain a conjunction or a filler word (`With Mom and Dad Budget`), so the whole clause is tried before the list is split on `and`, and the filler scan stops where a name begins. A bare mention applies nothing: "Pickleball court fee" is a description, and labelling on it would tag "lunch with the pickleball crew" as a game. The two mistakes do not cost the same — a missing label is visible in the review, a wrong one moves money in `getLabelBreakdown`, which splits an amount across whatever labels a row carries. A name matching nothing the user owns is reported back rather than dropped, since a silently dropped label is the bug this exists for and the bot cannot create one. `loadLabels` returns a `LabelLookup` carrying `readable`, because an empty list means two different things and the reply used to pick the wrong one: "you don't have a label called pickleball, create it in the app" is confidently false when nothing could be read, and points at the wrong fix — the cause is a token minted without `labels:read`, not a missing label. Every path that can drop a named label says so, the shorthand and classifier confirmations included (`confirmCreated` takes a `notice`); `formatCreated` already lists what *was* applied from the server's own reply, so the notice carries only what went nowhere. The classifier path also parses the directive locally and merges it with the model's names: `transaction.labels` is something Gemini is asked to fill and is not obliged to, so "spent 350 yesterday, tag it work" could come back as a valid CREATE_TRANSACTION with `labels: null` and lose the instruction silently. The parser is deterministic where the model is not. A name the *model* invented is still dropped in silence, since nobody asked for it; only what the user asked for is reported. `get_label_list` is issued in parallel with `get_category_list` rather than behind a keyword test: a bare name has no keyword to gate on, and the two together cost the wall clock of the one round trip that gate was protecting. The review-correction path fetches only while a scan is actually waiting. A connector is consumed only when a name follows it, or "label it pickleball and Yosh will pay me back" loses the "and", and only an explicit conjunction carries the directive into a name that does not resolve — a comma separates clauses as often as names, so "label it pickleball, category fun" must not report "category fun" as a missing label. Parsing continues *past* a resolved name rather than stopping at the first miss: breaking there made order decide the outcome, so "label it pickleball and badminton" applied Pickleball, said nothing about badminton and left "and badminton" behind as the description, while "label it badminton and pickleball" applied nothing at all. A name is removed from the description only where the text is unambiguously an instruction — a colon, a filler word, or a real label named — so "price tag Nike" may earn a note but never loses "tag Nike" from the description. A label whose `applicable_to` excludes the transaction's type is a third outcome, neither applied nor "missing": `createTransactionBatch` type-filters explicit ids *silently*, so a review promising an income-only label on a receipt showed it and then quietly did not write it, and "create it in the app" is the wrong advice for a label already sitting there

- **Labels reach the write on every path** — the receipt review (`scanToTransaction` in `confirm-scan.ts`), the shorthand logger, and the classifier, which may now name labels on a `transaction` and has them resolved by `findByName` against the real list, exactly as `parseSearchIntent` does for a search. `labelIds` is sent **only** when the user named one, and omitted otherwise so auto-apply schedules still run. Sending it explicitly overrides the MCP tool's `labelIds: t.labelIds ?? (hasTrustworthyTime(...) ? undefined : [])`, which turns an omitted value into an opt-out for any date but today: correct for a *schedule*, whose premise is a real clock a backdated receipt does not have, and wrong for a label the user asked for by name. A receipt scanned the morning after the purchase hits that every time, and it is why the label went nowhere even before the caption was understood
- **Receipt scanning over MCP** (`src/lib/receipt-scan.ts`): `scanReceipt` is the single scan path, shared by `POST /api/receipts/scan` and the MCP `scan_receipt` tool, so the role gate, the monthly cap, the rate limit and the reserve/refund all apply to both. The tool returns a *draft* and writes nothing: saving still goes through `create_transactions`, which keeps one create path. `receipts:scan` is a **privileged** scope even though it writes nothing, because each call spends a metered, paid resource: `isWriteScope` tests `endsWith(":write")`, so without `isPrivilegedScope` it would have fallen into `READ_ONLY_SCOPES`, which is the default grant and what the local stdio server runs with. `receipt-scan.ts` is imported dynamically inside the tool handler, since it pulls in `gemini.ts`, which builds its client on load and throws without `GEMINI_API_KEY`
- **Receipt scan quota** (`src/lib/scan-quota.ts`) — a credit is reserved *before* the Gemini call and settled after: `SUCCESS` spends it, `FAILED` refunds it, so users are never charged for a scan they can't use. Reservations serialise per user with a Postgres advisory lock (a bare count-then-insert cannot enforce a limit under READ COMMITTED). Because refunds mean the monthly limit no longer bounds API spend, a rolling attempt rate limit does. `FAILED` rows are kept, not deleted, so refunded attempts still count toward it
- **Receipt itemization** — multi-scan groups transactions by `receiptGroupId`; per-transaction `receiptBreakdown` JSON stores individual line items for each category
- **AI Assessment** (`src/lib/ai-assessment.ts`) — Gemini turns the analytics page's already-computed `AnalyticsData` into a personalized report; two parallel calls (structured data analysis + grounded web tips via Google Search), cached per period in `AiAssessment`, metered by `AiUsageLog`. Prose is privacy-safe by construction (relative/percentage language, not raw amounts). The report now has two halves, and the split is the point: `src/lib/assessment-facts.ts` computes the findings and the model only *interprets* them. Handed five totals, a model cannot see that July is missing fifteen days of logging or that a bill has had no payment recorded since June, so it invented patterns instead -- the one thing a report about money must not do. New AI sections (`outlook`, `patterns`, `trends`, `dataQuality`) each default to empty in `assessmentReportSchema`, and `GET /api/assessment` re-validates stored rows on the way out, so a report cached before a section existed still renders

- **Assessment facts** (`src/lib/assessment-facts.ts`, loader in `assessment-facts-query.ts`, served by `GET /api/assessment/facts`) — the deterministic half, and the **single** implementation of these analyses. The `finance-assess` skill used to carry its own `assess.sql` computing the same nine of them, and within days the two had drifted: the SQL listed ten "new recurring charges" where this listed none, and scoped the unlinked-payment check to all history where this scoped it to the bill's own lifetime. Same question, two answers, nothing to catch it — and the gap widened while it sat, the SQL's unlinked list growing from one false positive to two, both of them payments made *before* the bill they were matched to existed. `scripts/assess.ts` prints this module and reproduces every figure `assess.sql` did, so the skill now runs it and the SQL was deleted in #227 — never reintroduce a second implementation; extend the module and both consumers gain it at once. Computed live rather than cached beside the prose: these are cheap aggregates over the user's own rows, and finding out a bill has gone unpaid should not cost an AI generation. Pure functions over injected rows, so all of it is unit-tested without a database; `scripts/verify-assessment-facts.ts` drives the real query path against a real one, which is where the three bugs below were found. Things settled and worth not relitigating:
  - **The coverage gate comes first.** A month logged on fewer than 60% of its days is a gap, not a cheap month, and is excluded from every rate, average and trend. The calendar is generated first and rows bucketed onto it, so a month with *no* rows still appears at 0% instead of vanishing
  - **Missed occurrences walk forward from `nextDueDate`, never from `startDate`.** That is the app's own cursor. Occurrences earlier than it were already passed over, and reporting them contradicts the bills page while telling the user to chase payments the app never asked for -- that drift is `heal-bill-next-due-dates.ts`'s job. "Passed" means strictly before the user's own today, the same rule `getUpcomingBills` uses for `isOverdue`, so a bill due today is not late. A live snooze is a deferral the user chose and is not a miss; a lapsed one is
  - **A partial month is compared against the same days of the baseline months, not scaled up.** Spending is front-loaded -- rent and the utilities land in the first week -- so a linear projection on day six multiplies one rent payment by five and cries wolf every month. `throughDay` clips both sides of every category comparison, and the pace anomaly is a ratio between comparable windows
  - **A charge's first sighting comes from the whole history, not the window.** The loader adds a `groupBy(description) _min(date)` for exactly this: without it a subscription running two years enters a six-month window looking 120 days old, and every established charge was reported as creep. A new charge must also cost at least 1% of a month's spending, or the list is led by bananas and jeepney fares
  - **Category movements are zero-filled** across the baseline months. Averaging only the months a category appeared in measures it against itself: seen once at 100 across four months it reads as a baseline of 100 rather than 25, so a rise to 200 is reported as +100% instead of +700%. Ranked by money moved, never by percentage
  - **`swing` is read before `variance_pct`.** A metered bill whose budget falls *inside* the range actually paid is `seasonal` and must not be told to "fix" its figure; one budgeted at 100 and paid 300-600 also swings 2x but is simply `under-budgeted`, and its warning stands. Both conditions are required
  - **The headline is windowed but the balance is not.** Rates and the burn average over the trustworthy months only, so a logging gap cannot flatter them; `runningBalance` is every row the user has, because what an account holds is not a property of the window being assessed. `monthsOfRunway` is null rather than negative when the balance is under water — a negative month count reads as a figure rather than as a warning
  - **Unlinked bill payments read all history**, unlike everything else here, but only from the bill's own `startDate`. The finding is about the bill's integrity rather than this period's spending, so the window would clip it -- and a payment made *before the bill existed* settled no occurrence, because there were none. The SQL this replaced had no such guard, and the one finding it produced on real data was exactly that false positive. The loader prefilters on the bill name's longest **token**, not on the name: descriptions are never trimmed or normalised on write (one real account holds nine rows with edge whitespace and two with a doubled inner space), SQL equality does no trimming, and even `contains` of the whole name misses `Mirea  Rent` — that string does not contain `Mirea Rent`. A bare token survives every spacing variant `foldDescription` would normalise, and the fold narrows the extras back out. The token is split on **apostrophes** as well as whitespace (#252): this prefilter runs in SQL, which cannot fold, so a bill named `Angel’s Rent` searched on `Angel’s` drops a payment written `Angel's Rent` before the fold is ever reached -- and a unit test of the pure matcher cannot see it, since it is handed a candidate the real query would have discarded
  - **`runningBalance` is `null` when unknown, never `0`.** A balance of nothing and a balance nobody supplied render identically, and one of them is a figure the report invented. `monthsOfRunway` means "if income stopped", which is why it divides by gross spending and why the card says so -- unlabelled, a healthy saver reads a growing balance as a countdown
  - **Unlabeled spend is split by cause.** Bill payments bypass label auto-apply, so those rows are the app's behaviour and not the user's carelessness. One combined total would turn a system gap into a lecture
  - **`foldDescription` folds apostrophes and no other punctuation** (#252). iOS substitutes U+2019 as you type, so one source is written both ways by the same person on the same phone, and six analyses key on this fold -- an income source counted twice, a charge that reaches `RECURRING_MIN_MONTHS` in total and in neither spelling, a double-submit typed once each way. The one that matters most is `findUnlinkedBillPayments`, which matches payments against bill *names*: there the split is a false negative on a stalled schedule, and silence is indistinguishable from a clean result. It stops at apostrophes on purpose -- `findFragmentation` strips every non-alphanumeric, and folding that far would merge `7:11 Hot Choco` with `711 Hot Choco` and hide those spellings from the one report meant to surface them. The two disagreeing is **not** drift: `findFragmentation` reports what is *stored* (still two spellings, still worth cleaning up), while the fold decides what is *analysed*. The rule lives in the one function because the loader keys `historyFirstSeen` the same way, and two folding rules would stop the two maps meeting. The fold is not sufficient on its own, though: `longestToken` had to split on apostrophes too, or the SQL prefilter behind `findUnlinkedBillPayments` discards the row first
- **TanStack React Query** — all data fetching uses React Query; `queryKeys` object in each query hook scopes cache invalidation; `query-client.ts` exports a factory (needed for server/client separation)
- **Shared transaction writes** (`src/lib/transaction-writes.ts`): `createTransactionBatch` is the single create path, injected with `prisma` and shared by `POST /api/transactions/batch` and the MCP `create_transactions` tool. It owns the advisory-lock idempotency, the label resolution rules (`undefined` auto-labels, `[]` opts out, explicit ids are deduped and type-filtered), and the category-ownership check. A second copy would drift the moment either changed
- **Shared transaction updates** (`src/lib/transaction-writes.ts`): `updateTransactions` is the edit path behind the MCP `update_transactions` tool. It is deliberately *not* wired into `PUT /api/transactions/[id]`, which keeps its own implementation. Sharing it is the obvious next step and was tried: it hands the browser a stricter server than the form was written against -- the form posts a stale `categoryId` across a type change, which the effective-row check below rejects -- and the form work that follows is a separate change with its own risks, so it belongs in its own PR rather than riding along with a new tool. Every check runs against the **effective** row -- the patch merged over what is stored -- never against the patch alone, which is what catches a bare `type` flip that leaves an untouched category behind: `categoryId` is absent from the patch, so nothing about it looks wrong, and the row would end up an income transaction filed under a food category, distorting every breakdown that groups by one. The check runs only on rows whose pair actually **moves**, compared against the stored row: judging an unchanged pair prevents nothing, since re-sending it writes what is already there, and it would lock the caller out of rows that were *already* mismatched -- reachable with no MCP involvement, because `PUT /api/categories/[id]` lets a custom category's type be flipped under its transactions. Labels follow the create path's rule minus its schedule branch: explicit ids are deduped and type-filtered, `[]` clears them, and omitting the field preserves what is there while dropping only what the effective type excludes. A label the caller does not get is **reported** as `droppedLabels` rather than dropped in silence, from either direction -- named explicitly and filtered out, or already on the row and excluded by a changed `type`. The implicit half matters as much: `changed` and `previous.labels` show the label leaving but never why, and an unexplained disappearance reads as a bug in the tool. Schedules are **never** re-run on an edit -- a schedule's premise is a real clock at the moment of spending, so re-matching would let correcting a typo in a description silently re-tag the row over a choice the user made by hand. Dates are resolved **here**, against the row, never pre-resolved by the caller: `resolveTransactionDate` fills a bare `YYYY-MM-DD` with the current clock, which is the only choice when creating a row and destructive when editing one. Read tools return `localDate`, so a model correcting an amount and echoing the date back is the expected call, and it would have moved a 17:00 purchase to whenever the request arrived while reporting `changed: ["date"]` with an identical before and after. A bare date keeps the row's stored time-of-day and carries it onto whatever day is named, **milliseconds included**: the offset into the local day is a millisecond count rather than an `HH:mm:ss` string rebuilt through `resolveTransactionDate`, which leaves the fractional part non-capturing and rebuilds through `Date.UTC`, taking no ms argument. Rows carrying milliseconds are ordinary -- `POST /api/bills/[id]/action` stamps bill payments with a bare `new Date()` -- so truncating would shift the instant and re-introduce the phantom change. A date change that stays *inside* one local day is the one case day-only rendering cannot express, so both ends of it carry an `HH:mm` and only then. The tool's own `date` description has to say all this, since it is the only contract the model sees: while it still claimed a bare date was filled with the current clock, a model would have invented an explicit time to avoid that, which really does overwrite the stored one. All-or-nothing across the batch, because unlike a create there is no idempotency key to replay with, so a half-applied batch leaves the caller unable to say which rows moved. The audit stamp follows the **change**, not the request: a patch restating stored values moves nothing, and stamping it would rewrite a genuine trail for something that never happened. Everything the write depends on is read **inside** the transaction, under a row lock taken as its first statement (#233). It used to read the rows, check category ownership and resolve labels on `prisma` *before* `$transaction` opened, and everything the write decided came from that snapshot. Two reviewers read that as misreporting -- `previous` and `changed` describing a value a concurrent edit had already replaced -- which is cosmetic, since the writes use partial `data`. The third case is silent data loss: a patch that flips `type` and omits `labelIds` preserves labels from the snapshot, `labelsMoved` is true because the type change dropped an incompatible one, and the path then runs `deleteMany` + `createMany` with the stale set -- so a label added concurrently is deleted and nothing reports it. Moving the read in is not sufficient on its own; under READ COMMITTED a concurrent transaction can still commit between the read and the write, so it takes `SELECT ... FOR UPDATE` first. The part worth not relearning is that **no other writer has to cooperate**. There are six others -- `PUT /api/transactions/[id]`, the batch `PATCH`, `POST /api/labels/[id]/apply` and the label routes -- and none takes this lock, because inserting a `transaction_labels` row takes a `FOR KEY SHARE` lock on the referenced parent through the foreign key, and `FOR UPDATE` conflicts with it. That is the same FK interaction `settleBill` documents from the other side, where taking the row lock *after* an insert deadlocks, and it is why this one runs first and never after. It is also why the lock may not be weakened to `FOR NO KEY UPDATE`, which does **not** conflict with `FOR KEY SHARE` and would silently reopen the whole thing; `verify-transaction-update.ts` checks that directly. `ORDER BY id` is load-bearing rather than tidy: two concurrent batches naming overlapping ids in different orders would each hold what the other waits for. `categoriesAreUsable` had to widen to `PrismaClient | Prisma.TransactionClient` to be callable in there -- `TransactionClient` is `Omit<PrismaClient, ITXClientDenyList>` and is not assignable to `PrismaClient`. The two pure checks (`DUPLICATE_ID`, `NO_FIELDS`) stay outside, since taking a row lock to reject an argument error buys nothing. A failed write still splits two ways: `P2003`/`P2025` means the request names something no longer there and retrying can only reproduce it -- `WRITE_REJECTED`, told to rebuild the request -- while anything unrecognised is `WRITE_FAILED` and worth another attempt. One reason advising retry for both is how an agent loops. That split narrowed when the checks moved inside -- the check-to-write gap they described is gone -- but it did not close: a `Restrict` foreign key still refuses at write time
- **Shared bill writes** (`src/lib/bill-writes.ts`): `settleBill` is the single path for acting on one occurrence -- `pay`, `pay_existing`, `skip`, `snooze` -- shared by `POST /api/bills/[id]/action` and the MCP `pay_bill` tool, which is now a thin mapping from its result to a status code. Settling is not "write a transaction": it locks the bill row **as the transaction's first statement** (the log and transaction inserts take a FOR KEY SHARE lock through their foreign keys, so upgrading to FOR UPDATE afterwards deadlocks), refuses a second terminal log on the same occurrence (there is no unique index on `(scheduledTransactionId, dueDate)`, so this guard is the whole defence against a double submit paying a month twice), walks from the *locked* `nextDueDate` to the earliest occurrence with no terminal log rather than from the one just acted on (advancing from the acted-on occurrence silently discarded every unpaid one before it), and switches the bill off when the walk runs past `endDate`. The `dueDate` must name an occurrence the schedule actually **produces**, walked from `startDate` and never computed modularly (`computeNextDueDate` clamps to month length, so a bill starting on the 31st falls on the 30th in November). Nothing checked this before and a real but wrong date wrote a payment and a PAID log against an occurrence that does not exist -- and since the walk matches candidates by exact timestamp, the phantom log matched nothing, the cursor never moved and the reminder kept firing, which is the very failure the tool exists to prevent. A date that already carries a log is accepted regardless of the current schedule: editing `startDate` moves the recurrence out from under occurrences settled under the old one, and refusing those makes history unreachable rather than safe. A variable bill refuses `pay` without an explicit `amount`, because its stored figure is a forecast and the estimator reads the ledger back as history -- one wrong click compounds into every future estimate. A fixed bill *ignores* a supplied amount, or a stale client could write a payment that disagrees with the bill it settles. `pay_existing` claims the payment conditionally on `billId: null` before writing anything, so it cannot re-point a payment that already belongs to another bill, and it deletes a superseded `SKIPPED` log rather than leaving the month listed twice. That claim writes `billId` onto a row that already exists, so it is an **edit** and stamps `updated_via` / `updated_by_mcp_token_id` with the acting surface (#256) -- otherwise a row corrected over MCP and then linked from the app went on naming the token as its last editor, which is worse here than on an ordinary edit, since this settles an occurrence, advances the cursor, and cannot be unlinked. The `billId: null` predicate already restricts the write to the row actually claimed, so the "stamp only what moved" rule the app's edit paths had to engineer comes free. `createdVia` names the caller rather than the verb: it reaches `created_via` on the transaction `pay` creates and `updated_via` on the one `pay_existing` claims, and both call sites pass it explicitly, so the APP fallback is a backstop rather than the app's actual route. Ownership was once its *only* check, which was survivable while the browser picked from `GET /api/bills/[id]/candidates` -- already narrowed to the bill's type, category and `PAYMENT_WINDOW_DAYS` either side -- and is not survivable for a model naming an id, since nothing anywhere in the app can unlink a payment. Type and window are now refusals; a **category** mismatch is a `warnings` entry instead, deliberately: the candidates list hides miscategorised payments, which makes naming the id the only way to attach one, and such a payment is exactly the mess this action exists to clean up. `paymentWindow` is exported from here and used by the candidates route, so the list and the write cannot disagree about what is offerable. Snooze is the odd one out and had two bugs of its own: it wrote outside a transaction, skipping the `assertStillPermitted` re-check every other branch runs, and it had no occurrence guard at all -- so a retry after a lost response stacked a second `SNOOZED` log and, on a later day, pushed `snoozeUntil` further out, contradicting the tool's own `idempotentHint`. A *live* snooze on the occurrence now replays (`replayed: true`, nothing written); a lapsed one does not, since re-snoozing after it expires is a fresh decision. `createBill`/`updateBill` sit beside it: `createBill` is shared with `POST /api/bills` and adds the category-ownership check that route never had (survivable while the only caller was a form that can offer nothing but the user's own categories, not survivable for a tool a model calls with an inferred id). `updateBill` is a **patch**, merged over the stored row, and is deliberately *not* wired into `PUT /api/bills/[id]`: there an absent `endDate` means "cleared" while an absent `labelIds` means "leave alone", two readings of the same absence that one function cannot hold at once. Its checks run against the **effective** row, which is what catches a bare `type` flip leaving an untouched category behind, and only where the pair actually moves -- judging an unchanged pair prevents nothing and would lock the caller out of bills that were already mismatched. A schedule walk runs only when the schedule's *shape* moved (frequency, interval, start date); a changed amount does not move a due date. `endDate` is deliberately **not** part of that -- it says where the recurrence stops, not where it falls, and re-walking would drag a cursor backwards over an edit that had nothing to do with it -- but it is checked separately, because an end date pulled back before the cursor left the bill active pointing past its own end, and nothing downstream filters on `endDate` (`getUpcomingBills`, `/api/bills/upcoming` and `pending-bills.ts` all select on `isActive` alone), so it showed as permanently overdue and mailed reminders for ever. That deactivation is reported as `deactivated` rather than inferred from `changed`, which names `endDate` and never `isActive`. `endDate` also accepts an explicit `null` to clear it: without that, setting one over MCP was a one-way door. `PUT /api/bills/[id]` keeps its own implementation but now applies the same end-date rule (#240), and derives it the same way -- `lockBillRow` is exported from here and taken as that route's first statement too, with the walk and the cursor read under it. Derived from the row read *before* the transaction, both halves were wrong under a concurrent settlement: the walk missed a payment's log and put the cursor back on the occurrence just settled, and the cursor check missed an advance past the new end date, leaving exactly the permanently-overdue bill the fix exists to prevent. The rule itself: the cursor is the recalculated one where the shape moved and the stored one otherwise, and a cursor past the new `endDate` switches the bill off. Fixing it there also exposed a second gap -- the schema leaves `customIntervalDays` absent on every non-custom bill while the column holds `null`, so a raw `!==` made *every* save look like a frequency change and re-walk the schedule from `startDate`, pulling a cursor a snooze or a payment had moved back to the first occurrence the walk found. Both sides are normalised with `?? null`, matching what the update writes. The two implementations are still separate; converging the form on `updateBill` is its own change
- **Shared label writes** (`src/lib/label-writes.ts`): `createLabel` behind `POST /api/labels` and the MCP `create_label` tool. Small, but worth sharing for one property: the duplicate check is **case-insensitive** and there is no unique index behind it. The label resolver matches without case and reports two candidates as ambiguous, so letting "work" exist beside "Work" would make the bot refuse every mention of either -- a label nobody can use, created by a call that reported success. `P2002` is read as a duplicate too, so a concurrent create loses cleanly if an index is ever added. `removeTransactionLabels` also lives here: the single **removal** path, shared by the bulk `PATCH /api/transactions/batch` label branch and the `POST /api/labels/[id]/apply` stale-link branch (#251). Both used to plan the removal from a snapshot read before the delete and then stamp `updated_via: APP` on every row in that plan, which a concurrent writer removing the same link first turned into a partial no-op with the rows stamped anyway -- an `APP` edit written over an accurate MCP trail for a change that never happened, and `updated`/`ids` over-reporting by the same amount. The sibling *insert* branches closed this in #247 with `createManyAndReturn`; there is no `deleteManyAndReturn` in Prisma 6.19.2 and `deleteMany` reports a count with no row identity, so this one drops to `DELETE ... RETURNING transaction_id` -- the one place raw SQL is used for a thing Prisma cannot express rather than for a lock. Re-reading the links inside the transaction just before the delete was deliberately **not** the fix: under READ COMMITTED that narrows the window to microseconds without closing it, which reads as fixed and is not. Matched on `(transaction_id, label_id)` rather than on link-row ids, which is what lets one helper serve both callers and is the identity they actually mean (`@@unique([transactionId, labelId])` allows one row per pair); the apply route therefore collects transaction ids, not link ids. Joined to `transactions` on `user_id` so ids a caller has not narrowed still delete nothing of anyone else's, and the returned transaction ids are deduped, since one row losing two labels is one edited row. Raw SQL means the `@map` names are restated in application code, which is the approach's one real cost: `TRANSACTION_LABELS_TABLE`/`TRANSACTION_LABELS_COLUMNS` hold them in one place and `label-writes.schema.test.ts` asserts they still match `prisma/schema.prisma`, since a rename would otherwise type-check clean and 500 at runtime
- **Assessment facts over MCP** (`get_assessment_facts`): the deterministic half of the assessment, served from the same `collectAssessmentFacts` the app uses, with no AI call. It requires `budget:read` **and** `transactions:read` **and** `bills:read` -- `MCP_TOOL_SCOPES` takes a list meaning every scope in it, checked by `grantCoversTool` -- because the payload carries transaction descriptions, amounts and dates (`hygiene.duplicates`, `recurring.items`) and full bill payment history, and `MCP_SCOPE_LABELS` promises `budget:read` means aggregates. Nobody re-mints: all three sit in `READ_ONLY_SCOPES`, so only a token deliberately narrowed loses it. It exists because a client handed five totals re-derives coverage, pace and baselines itself and reproduces exactly the failure the two-half split was built to prevent -- a month logged on 16 of its 31 days reads as a cheap month rather than a gap. Exposing it needed the `next-auth` augmentation moved out of `src/types/index.ts` (see the bill-date note below), since `@/types` was unreachable from `mcp-server/`'s type-check until then. The output schema mirrors `AssessmentFacts` field for field under `assertExact`, nine nested structures deep, which is where drift would otherwise be invisible
- **MCP writes** are gated by three independent controls, none of which substitutes for another: the write scope (least privilege, fixed at mint, and such a token may not choose "Never" and is capped at 90 days), `users.mcp_writes_enabled_until` (a *lease*, not a boolean, so forgetting to switch it off cannot leave writes open for days), and the provenance columns (audit, set server-side so a compromised token cannot forge or omit it). `transactions:write` covers **both** transaction writes, creating and changing, while bills and labels have their own: `bills:write` and `labels:write`. Settling an occurrence is a different authority from adding a row -- it advances a schedule cursor, writes a terminal log nothing here can remove, and can switch a bill off -- so folding it into `transactions:write` would have handed that to every token already holding it, the Telegram bot's included, with no re-mint and no notice. That is the opposite trade from the one taken for editing below, and deliberately: there the cost of a new scope was a re-mint of a credential that already existed, here it is a scope nobody has yet. Editing had its own `transactions:edit` scope first, which is the safer shape -- a leaked create-only credential adds junk that is visible and deletable, an edit-capable one rewrites recorded history -- and it was folded back because the cost lands on the wrong person: every already-minted token is powerless to edit until re-minted, and here that is one individual narrowing a credential only they hold. The consequence is recorded rather than hidden, since the Telegram bot's token gains editing it never had: no handler calls it, but a leak could. Splitting it out again is tracked as its own issue and is worth doing the moment this serves more than one person. `resolveWritePermission` still takes the scope for the action attempted, with no default, even though every caller passes the same value today -- "may this token write?" stops being the right question the moment a second write scope exists. `isWriteScope` stays an explicit list rather than `endsWith(":write")` for the reason `isPrivilegedScope` exists: a suffix test decides authority by spelling, and a scope named `transactions:edit` would land in `READ_ONLY_SCOPES`, the default grant, handing every caller that names no scopes -- the local stdio server included -- the power to rewrite history. Audit follows the verb too: `created_via` + `mcp_token_id` say how a row came to exist, `updated_via` + `updated_by_mcp_token_id` say who last changed it, and an edit never touches the first pair -- a row typed into the app and later corrected over MCP is both, and one column cannot say that. The app's own edit paths stamp it too (#232), so a row corrected over MCP and then fixed in the browser stops naming the token: `PUT /api/transactions/[id]`, both branches of `PATCH /api/transactions/batch`, `POST /api/labels/[id]/apply` and `DELETE /api/transactions/[id]/labels/[labelId]` all write `updated_via: APP` and clear `updated_by_mcp_token_id` rather than leaving it, since a stale id is not a gap in the trail but a confidently wrong answer. `settleBill`'s `pay_existing` stamps it too (#256), from whichever surface called it, since attaching a payment writes `billId` onto a row that already exists. Getting the columns right is the easy half; the rule that matters is that each of them stamps **only rows that actually moved**, compared against what is stored rather than against which keys the request carried. The form posts all five fields on every save, so "the request named it" is true of every field on every edit -- pressing Update with nothing changed would rewrite an accurate MCP trail to APP for an edit that never happened, and bump `@updatedAt` with it, so that save now writes nothing at all (its label sync used to delete and recreate the same links regardless). A bulk recategorise skips rows already in the target category, for the same reason at forty rows. The two label branches change no column on `transactions`, so they need their own `updateMany` rather than folding the stamp into an existing write. Where it deliberately stops: narrowing a label's type or deleting a label also removes associations, and those are edits to the **label** -- recording an edit on every transaction that referenced it would make renaming one thing look like touching hundreds. There is still **no delete tool** for anything, so a leaked write-capable token can garble rows, which is visible and correctable, but can never make them disappear. A bill is the closest case and stays inside the rule: `update_bill` can only switch one off, which keeps every payment it recorded and is undone by switching it back on. Provenance follows the *credential*, not the endpoint: `mcp_tokens.source` is chosen at mint ("AI assistant" or "Telegram bot") and stamped onto every row that token writes, because every remote write arrives through `/api/mcp` and deriving it from the endpoint made the Telegram bot's rows claim Claude wrote them. `APP` is not mintable, so a token can never make a row look hand-typed. Provenance is a column and not a label because `getLabelBreakdown` splits an amount evenly across a transaction's labels, so a provenance label would divert half of every MCP-written expense out of its real category, and labels are user-deletable
- **MCP date windows** (`resolvePeriod` in `src/lib/budget-queries.ts`): seven tools take either a `month` or an explicit `from`/`to` day range, never both -- a filter that applies half of what was asked returns rows indistinguishable from a complete answer. Both bounds are inclusive, so `to` resolves to 23:59:59.999 of that **local** day; resolving it to midnight would silently drop the last day of every window. An omitted bound is left **out of the predicate** rather than filled with a sentinel: `gte: new Date(0)` would drop anything before 1970 and makes a lone `to` fail an ordering check against a `from` nobody sent, so the backwards-range check only fires when both ends were given. An impossible day (`2026-02-31`) is refused rather than rolled forward, since `Date.UTC` turns it into 3 March and would query a window nobody asked for. Every result echoes the window it actually used as `period` (`{month, from, to}` in the user's calendar days), so a caller reports the period it was given instead of re-deriving one. `describePeriod`/`describePeriodOrCurrentMonth` are exported for the two tools whose query returns a bare array and whose MCP envelope carries the echo. The echo also carries `isPartial`/`daysInPeriod`/`daysElapsed`, because the bounds alone cannot say whether the window has *finished*: a running month and a closed one were reported in the same shape, so a third of a month's spending read as a complete result (#236). An open end counts as partial, since a window running to now has not finished by definition
- **Refreshing the local mirror** (`scripts/refresh-local-mirror.ts`): `/finance-assess` reads the local database for its pattern work, so the mirror going stale produces a confident report about figures that have moved -- one quoted a balance 22,000 out of date. The script dumps a source and restores it over `DATABASE_URL`, dry run unless `--apply`, backing the local database up first and printing the command to undo. It refuses unless the destination is local, using the same `isLocalDatabase` that guards `db:migrate`: it drops and recreates every table it restores, so a reversed `--from` would destroy the source, which is the one mistake here that a backup taken afterwards cannot fix. **Matching row counts do not mean fresh** -- a settings change moves no rows, and on 6 Sep both sides held 829 identical transactions while the mirror had `is_variable = 0` against production's `2`. Cross-check MCP's `runningBalance`, which reaches the app over HTTPS and so keeps working when direct Postgres access is closed (#194)

- **Variable-amount bills** (`scheduled_transactions.is_variable`, `src/lib/bill-estimate.ts`): a bill's `amount` does two jobs -- what the reminder asserts you owe, and what the forecast expects. For a fixed bill those are one figure; for a metered one they are not. Meralco swung 2.7x in a year (5,300 to 14,126) while its budgeted 5,500 sat within 150 of what its *cool* months cost, so no constant is right and "raise it to the annual average" makes the near-term forecast worse. A variable bill's forecast is therefore derived: **same month a year ago** where a year of history exists, else **the last payment**, never a multi-month mean -- a mean spanning a seasonal swing resembles no month at all, and gave a cool October 8,919 where September's actual 5,990 was close. `amount` stays NOT NULL and is the fallback until payments exist: a nullable one would have made `/api/bills/upcoming` sum a certain payment as zero, trading a forecast wrong by 53% for one wrong by 100%. The reminder email prints "amount varies" rather than a figure, which is the half of #217 that motivated it, and every derived figure carries `isEstimate` plus its basis so no caller can print a guess as an assertion

- **Bill date arithmetic is UTC** (`src/lib/bill-dates.ts`): `utcDayStart`, `addUtcDays` and `clampToMonth` are the only way server-side code truncates or advances a bill date. `setHours(0,0,0,0)` and `setDate(getDate()+n)` work in the *process* zone, which is a no-op only while the server happens to run in UTC — nothing pins `TZ`, so that was the whole guarantee. On a host in Asia/Manila a due date of the 5th was stored as `2026-09-04T16:00:00Z` and every reader taking the UTC day reported the 4th (#184). `computeNextDueDate` builds each result from UTC components rather than `setMonth(+1)`, which overflowed *out* of the month it aimed at: 31 January became 3 March, and the clamp then read March's length and returned 31 March, skipping February. `userToday(tzOffset)` resolves the *user's* calendar day and encodes it at UTC midnight, and is what "today" means for a reactivated bill and for the start of a snooze: between the user's midnight and UTC's, a plain `utcDayStart(new Date())` is still yesterday, so a reactivated bill came back already overdue and a snooze started at 02:00 in Manila expired the same morning. `originalStartDay` is read with `getUTCDate()` at every caller, since `computeNextDueDate` works in UTC and a local reading of a 31st is a 30th on any host behind Greenwich. `snoozeUntil` is therefore date-only like a due date and is **not** converted on read: the write already resolved the user's offset. Browser code follows the same rule and not a looser one: `utcDayKey` names the calendar day a stored bill value stands for, `formatBillDate` pins `timeZone: "UTC"`, and `describeDueDate` compares against `userToday(user.timezoneOffset)`. `src/app/(app)/bills/page.tsx` and `bill-form.tsx` used to truncate in the browser on the theory that the process zone is the user's; that is true of an instant and false of a UTC anchor, which moves to the previous day for every viewer west of Greenwich, and it was only ever right by luck while the browser zone matched the account's. In the form it was a *write* bug: the edit modal showed the 4th for a bill starting the 5th, and pressing Update with nothing changed posted that day back and recalculated the whole schedule from it (#158). A new bill's default start date is the opposite case — a real instant — and comes from `accountDateKey(new Date(), user.timezoneOffset)`, never `toISOString().slice(0, 10)`, which is UTC's day and not the account's. The module has **no imports**, which was originally forced: `bill-utils.ts` pulls in `@/types`, `@/types` used to carry the `next-auth` module augmentation, and `mcp-server/` has no next-auth, so routing these through there broke its separate type-check while the root one stayed green. The augmentation now lives in `src/types/next-auth.d.ts`, which the root tsconfig picks up and `mcp-server/tsconfig.json` (its own `src` only) does not, so `@/types` is reachable from the MCP graph and `get_assessment_facts` can exist at all. Keeping this module import-free is still worth doing on its own terms -- it is the bottom of the date stack and nothing below it should need a graph -- but it is no longer load-bearing
- **Bill dates are calendar days, not instants** — `get_upcoming_bills` and `get_bill_history` carry `localDueDate` / `localSnoozeUntil` beside the raw instants, produced with `dayKey(utcDayStart(...))` and **never** `formatLocalDate`. A due date is date-only, stored at midnight UTC and meaning "the 5th" for everyone; converting it into a zone behind UTC moves it to the 4th and turns every on-time payment into a day late. `localActionDate` is the exception and *is* converted, because settling a bill happens at a moment. This is the half of #132 that #182 left, and the two together close it
- **Local calendar days on read rows**: every read row carries `localDate` beside its UTC `date`, from the same `formatLocalDate` the write path echoes confirmations with. The instant stays for ordering, time-of-day and label schedules; the calendar day is no longer something each client derives. Without it a UTC+8 user's 06:00 row, stored as the previous day at 22:00Z, is reported on the wrong day by anything that slices the ISO string
- **`search_transactions` aggregates**: `totals` (income, expenses, net, per-category subtotals) covers every match, not the returned page, so a caller never sums rows to answer "how much" -- a model doing that arithmetic gets it wrong long before the rows run out. `receiptGroupId` is on each row, because three rows from one split receipt are one purchase and nothing else in the payload said so. `compact` drops `categoryIcon`/`categoryColor`, which exist for the app's UI and are ~20% of a page's bytes
- **Anchoring relative dates**: `get_budget_overview` reports `today` and `timezoneOffset`. Nothing else in the tool set says what day it is, and a client without a shell that guesses guesses in UTC. Deliberately a field on an existing tool rather than an MCP resource: `MCP_TOOL_SCOPES` gates tools, so a resource would be a data path no scope narrows, and a field inherits the scope its tool already has -- no token needs reminting
- **Partial periods are marked, and comparisons are clipped** (#236): `get_spending_trends` clips **both** months to the same day of the month whenever `currentMonth` is the one still running, and reports it as `throughDay` plus a `currentPeriod`/`previousPeriod` echo. Comparing seven days against a finished month is not a comparison, and it fails in a consistent, reassuring direction rather than randomly: spending is front-loaded, rent and the utilities land in the first week, so every category not yet paid reads as a saving. On 2026-09-07 the tool reported a 77% fall in total spending and Housing at -100%, when the same seven days of August came to 15,883 against September's 19,121 -- a 20% **rise**, with the rent merely not yet due on the 17th. Clipping is by day of month, matching `throughDay` in `assessment-facts.ts` rather than adding a second rule, and is clamped to the comparison month's own length because February has no 30th and `parseLocalDay` correctly refuses one. Two finished months are compared whole. `get_monthly_summary` rows carry `isPartial`/`daysInMonth`/`daysElapsed` for the same reason and a `monthKey`, since `"Sep 2026"` is a label no other tool accepts as input. What this deliberately does **not** do is gate on logging *coverage*: a month can be complete and still be missing half its days' entries, and that judgement belongs to `assessment-facts.ts`, which already owns `MIN_COVERAGE_PCT`. A second, weaker coverage rule here is exactly the drift `assess.sql` produced (#227)

- **Shared budget queries** (`src/lib/budget-queries.ts`) — dependency-injected Prisma functions shared between API routes and the MCP server
- **MCP and label schedules**: `create_transactions` lets a user's auto-apply schedules run, but only when the timestamp reflects reality (`hasTrustworthyTime`): a time the caller supplied, or a bare date that is *today* in the user's zone. A bare date is filled with the current clock, so a backdated row would otherwise carry an invented time, and a Tuesday dinner entered on a Wednesday morning would land inside a weekday 05:00-17:00 window and be tagged as work spending. An explicit `labelIds: []` always opts out
- **Label schedules** — labels can have time-of-day + day-of-week schedules that auto-tag transactions; pure matching in `schedule-matching.ts`, server helpers in `schedule-server.ts`, client hook in `use-scheduled-label.ts`; first-created label wins on overlap; `labelIds: undefined` = server auto-applies, `labelIds: []` = user opted out
- **Label type restrictions** — labels have `applicableTo` ("EXPENSE" | "INCOME" | "BOTH"); LabelPicker filters by transaction type; schedule auto-labeling respects type; narrowing type on edit triggers 409 confirmation to remove affected associations; default controlled by `users.default_label_type` preference
- **Remote MCP auth** (`src/lib/mcp/tokens.ts`): static bearer tokens, chosen over OAuth 2.1 in #123. NextAuth v4 is an OAuth *client*, not a server, so there is nothing to plug the SDK's auth handlers into; a full authorization server was not worth it while this is single-user. Works in Claude Desktop and Claude Code, which set request headers directly, and in claude.ai web/mobile wherever **request-header authentication** is enabled (`authorization` is on Anthropic's accepted header-name allowlist and the value is sent verbatim, so it must include the `Bearer ` prefix). That feature is in beta and rolled out on request, so an account without it is limited to the two desktop clients. The credential is accepted as `Authorization: Bearer <token>` or `X-Api-Key: <token>`; `Authorization` wins when both are sent. `X-Api-Key` is not redundant: clients that implement OAuth own the `Authorization` header, so Claude Desktop's connector dialog refuses that name and `mcp-remote` reacts to its 401 by starting dynamic client registration instead of using the static credential. Authenticating on the first request avoids emitting the 401 that starts either cascade, and `x-api-key:<token>` also has no space, which `mcp-remote` cannot parse in a `--header` argument. Only the SHA-256 of a token is stored (a 256-bit CSPRNG secret needs no password KDF, and the request has to look the row up *by* the digest). Tokens carry subject-area scopes, an optional expiry, and revocation; out-of-scope tools are removed from the server rather than rejected on call, so a scoped token never advertises what it cannot use
- **MCP rate limiting**: a fixed window per token, applied in one atomic `UPDATE` so concurrent requests serialise on the row lock instead of all reading the same pre-write count. Charged *before* the revoked/expired branches: revocation is the response to a leak, so a revoked token is precisely the one whose replay needs a ceiling. `rate_window_start` must hold UTC (Prisma supplies it; the column's generated `DEFAULT CURRENT_TIMESTAMP` resolves to the session zone, so never raw-`INSERT` this table without the column, and do not hand-edit that default: `prisma migrate diff` then reports permanent drift). Every instant is computed *inside* SQL: Prisma maps `DateTime` to `timestamp without time zone` holding UTC, but a `Date` bound into `$queryRaw` is sent as `timestamptz` and compared through the session timezone. Under Asia/Manila that made every window look 8 hours stale, so the limiter reset on each request and enforced nothing
- **Timezone offsets** — all date-range queries accept a `timezoneOffset` (minutes, `getTimezoneOffset()` convention so UTC+8 is -480) for correct day/month boundaries; offset stored in `users.timezone_offset` and provided by `UserProvider`. One formula app-wide, `Date.UTC(y, m, d) + tzOffset * 60000` (see `/api/dashboard`, `analytics-period.ts`, and `parseMonth` in `budget-queries.ts`). In `budget-queries.ts` the param is optional and defaults to UTC, so **a caller that forgets it gets silently wrong months rather than a type error** — pass it explicitly from anything that has a user
- **MCP server** (`src/lib/mcp/`, `mcp-server/`): the tools are defined once in `src/lib/mcp/server.ts` and served over two transports: `mcp-server/` is a thin stdio entry point for a locally spawned client, and `/api/mcp` serves the same server over Streamable HTTP for a remote one. A second copy of the registrations would drift the moment a tool changed on either side, and nothing would catch it. `mcp-server/` is a standalone package; runs via `tsx` over stdio; every tool declares an `outputSchema` and returns both `content` and `structuredContent`. The SDK does **not** validate `structuredContent` against the schema, so `output-schemas.ts` pins each schema to the query layer's type with a compile-time `assertExact`; drift fails `pnpm type-check` instead of silently misinforming clients; tools register with `registerTool`; the 13 read tools declare `annotations: { readOnlyHint: true }`, which lets clients auto-approve them, and the seven that write or spend -- `create_transactions`, `update_transactions`, `scan_receipt`, `pay_bill`, `create_bill`, `update_bill`, `create_label` -- deliberately do **not**, so clients prompt before each one. `update_transactions` and `update_bill` are the only tools carrying `destructiveHint: true`, because they are the only ones that overwrite data that already exists; marking a create or a scan destructive would cry wolf on calls that cannot lose anything. `pay_bill` carries `idempotentHint: true` and is not destructive: it adds a payment and moves a cursor, and its occurrence guard means a retry after a lost response refuses rather than paying the month twice; user ID injected via `BUDGET_USER_ID` env var, resolved once at startup so an unknown id exits with a named error instead of serving zeros, and reused for the user's `timezoneOffset`; excluded from root `tsconfig.json`, so it has its own `pnpm type-check` that CI runs separately. Standalone in its dependency tree only: it imports from `src/lib/` and declares `@prisma/client`, `@modelcontextprotocol/sdk` and `zod` as `link:../node_modules/…`, sharing the app's copies rather than resolving second ones. Linking is what makes the shared registration safe: a file under `src/lib/` resolves its imports from the *root* `node_modules` whichever entry point loaded it, so a separately installed SDK here would put two different `McpServer` classes in one process. It also settles the `zod` hazard that pinning `^3.24.0` used to cover: leaving zod undeclared let pnpm auto-install zod 4 as an SDK peer, which type-checked the file against a different major than it ran on and made `tsc` exhaust the heap (`TS2589`). It also carries its own `.npmrc`, since npm config is read from the install cwd and the root hardening does not reach it

## API Routes Reference
- `POST /api/register` — registration with bcrypt + sends verification email
- `GET/POST /api/transactions` — list (filters/pagination/timezone) + create
- `GET/PUT/DELETE /api/transactions/[id]` — load one transaction for editing, update, or delete (ownership check). `PUT` writes nothing at all when the save moves neither a scalar nor a label, so pressing Update with no edits cannot rewrite the audit trail or `updated_at`
- `GET /api/analytics` — analytics data (income/expenses, category/label breakdowns, cash flow) with granularity, date range, timezone, and type filter params
- `GET /api/assessment` — cached AI Assessment report for a period (`granularity`/`from`/`to`); returns `{ report | null, generatedAt, model }`, re-validated through `assessmentReportSchema` so a row cached before a section existed still renders
- `GET /api/assessment/facts` — the computed half of the assessment for a period: coverage, missed bills, bill accuracy, category movement, recurring spend, duplicates and anomalies. Live, never cached
- `POST /api/assessment/generate` — generate/refresh the AI report for a period (Gemini structured analysis + grounded web tips); caches it and enforces a per-day cap
- `GET /api/assessment/daily-tip` — today's lightweight AI save/earn tip (lazily generated + cached per local day)
- `GET /api/dashboard` — aggregated stats, category breakdown, monthly trends
- `GET/POST /api/categories` — list (defaults + custom) + create
- `PUT/DELETE /api/categories/[id]` — update/delete (custom only)
- `GET/POST /api/bills` — list + create bills
- `PUT/DELETE /api/bills/[id]` — update/deactivate bills
- `GET /api/bills/upcoming` — bills due within 30 days
- `POST /api/bills/[id]/pay` — pay bill: creates transaction + advances next due date
- `POST /api/bills/[id]/action` — `pay` / `pay_existing` / `skip` / `snooze` for one occurrence. A thin wrapper over `settleBill` in `src/lib/bill-writes.ts`, shared with the MCP `pay_bill` tool
- `GET/POST /api/labels` — list (with schedules) + create labels
- `PUT/DELETE /api/labels/[id]` — update/delete labels (ownership check)
- `POST /api/labels/[id]/apply` — retroactively apply schedule to existing transactions. Stamps `updated_via: APP` on the rows whose associations actually moved, and on no others -- both branches derive that from what their write really did (`createManyAndReturn`, `DELETE ... RETURNING`), never from the page read that planned it (#247, #251)
- `POST/PATCH/DELETE /api/transactions/batch` — create transactions (with auto-labeling), bulk-change categories/labels, or bulk-delete. `PATCH` reports `updated` as the rows that actually moved, not the rows selected, and stamps `updated_via: APP` on exactly those -- on the label-remove branch that means the rows the delete's own `RETURNING` named, never the ones a pre-write snapshot planned (#251). create accepts an optional `clientBatchId` UUID that makes it idempotent, returning 200 with the original rows on a replay instead of 201. All three verbs return **413** (`code: "BODY_TOO_LARGE"`) above a 5 MB body, refused before the body is parsed and before the replay lookup
- `POST /api/transactions/selection` — return a bounded, server-owned snapshot of transaction ids and display metadata matching the submitted filters
- `POST /api/transactions/export` — export a bounded set of owned transaction ids as CSV in the user's local timezone
- `POST /api/receipts/scan` — Gemini OCR for single receipt (thin wrapper over `scanReceipt` in `src/lib/receipt-scan.ts`, shared with MCP); reserves a scan credit before the AI call and refunds it if the scan fails (403 over quota, 429 rate limited, 413 body too large)
- `POST /api/receipts/breakdown` — Gemini itemization by category for multi-scan; same credit reservation and refund rules as `/scan`
- `GET/PATCH /api/preferences` — read/toggle user preferences (hide_amounts, etc.)
- `GET /api/profile` — user profile info
- `GET /api/email/verify` — validate email verification token
- `POST /api/email/forgot-password` — send password reset email
- `POST /api/email/reset-password` — validate token + update password
- `POST /api/resend-verification` — resend verification email
- `GET/POST /api/quick-tiles` — list + create quick-log buttons from the web app (NextAuth session). Same rows and same rules as `/api/tg/tiles`, both thin wrappers over `src/lib/quick-tile-writes.ts`
- `PATCH/DELETE /api/quick-tiles/[id]` — edit or remove one. 404 rather than 403 on somebody else's
- `POST /api/quick-tiles/reorder` — the **whole** id set, as the Mini App's route takes it
- `POST /api/quick-tiles/log` — one tap. `created_via: APP`, no `mcp_token_id`; accepts a `clientBatchId` and replays it ahead of every other 4xx branch
- `GET /api/quick-tiles/frequent` — the derived Frequent list, its own route because it reads up to 1,000 rows and the grid must not wait on it. `excludeKeys` is the tiles' raw descriptions, exactly as `/api/tg/bootstrap` passes them
- `GET /api/tg/bootstrap` — everything the Mini App grid needs in one round trip: the user's currency and offset, the configured tiles with their *resolved* categories, the derived Frequent tiles, the category list for the editor, and the tile cap. Authenticated by `Authorization: tma <initData>`, never a session
- `GET/POST /api/tg/tiles` — list + create quick-log tiles (409 over `MAX_QUICK_TILES`, 409 on a duplicate label, 400 on a category the user does not own or whose type disagrees)
- `PATCH/DELETE /api/tg/tiles/[id]` — edit or remove one tile. 404 rather than 403 on somebody else's, since a 403 confirms it exists
- `POST /api/tg/tiles/reorder` — rewrite the grid order. Takes the **whole** set of the user's ids, refusing anything more or fewer, so a half-applied reorder cannot leave a grid nobody arranged; 409 when a tile was deleted mid-drag
- `POST /api/tg/log` — one tap. Writes through `createTransactionBatch` with `created_via: TELEGRAM` and no `mcp_token_id`, omitting `labelIds` so schedules run; accepts a `clientBatchId` and replays it ahead of every other 4xx branch
- `GET /api/cron/bill-reminders` — sends email reminders for pending bills (secured with `CRON_SECRET`); triggered daily by a Coolify Scheduled Task on production
- `GET /api/cron/telegram-prompts` — sends the Telegram evening prompt to users with `telegram_daily_prompt` on (secured with `CRON_SECRET`). Claims the day in `telegram_prompt_logs` *before* sending and releases it if the send throws, so a crash retries and a success cannot repeat. Returns **409** when more than one user has the prompt enabled, since nothing maps a Telegram account to an app user and the wrong guess reads one person's day and messages another about it
- `POST|DELETE /api/mcp`: remote MCP endpoint over Streamable HTTP, authenticated by a static bearer token. Runs the transport stateless (a route handler has no process to pin a session to) and builds a per-request server narrowed to the token's scopes. `GET` deliberately returns **405**: serving the standalone SSE stream from a stateless route would pin an open request and a keep-alive timer per client on a transport nothing writes to, and the SDK client reads 405 as "no stream offered" and carries on over POST. `POST` refuses a body over `MAX_MCP_BODY_BYTES` with **413** in a JSON-RPC envelope (#245)
- `GET/POST /api/mcp/tokens`: list + mint MCP tokens (NextAuth session); the plaintext is returned once and never stored
- `DELETE /api/mcp/tokens/[id]`: revoke a token (marks `revoked_at`, keeps the row for after-the-fact audit). `?permanent=true` deletes the row instead, and is refused with 409 on a token that is not already revoked, so removing a working credential takes two deliberate steps. Deleting cascades nothing: `transactions.mcp_token_id` is not a foreign key, so the rows a token wrote keep their provenance and only the name behind the id is lost
- `GET /api/health` — container liveness probe for the Coolify/Docker healthcheck; unauthenticated and deliberately touches no database (a deep check would restart every app on the shared Postgres during one blip)

## Design
- "Light & Warm" aesthetic with cream/paper-like backgrounds
- Fonts: Young Serif (headings) + Outfit (body)
- Color palette: warm browns, amber accents, green for income, red for expenses
- **Touch targets are at least 44x44px.** The iOS HIG figure, and WCAG 2.5.5. Adopted as a rule in #212 rather than left to taste, because it had been silently missed on every switch in the profile page at once. Where a control is deliberately smaller than its target — the 24px-tall preference switches are — extend the *hit area* with a pseudo-element (`before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']`) rather than growing the control. Making five settings rows taller to fix a finger-sized problem is the wrong trade
- **A failed save has to say so.** Optimistic updates are the house style and worth keeping: a toggle that waits for a round trip feels broken in the other direction. But the failure half has to exist too, or a control that flips back reads as broken rather than as a save that failed. `useSavePreference` (`src/hooks/use-save-preference.ts`) is the single path for every profile preference — optimistic apply, PATCH, roll back *and* toast on failure — and it distinguishes a server refusal ("please try again") from a request that never left ("check your connection"), since those send you to look at different things. There were **nine** hand-written copies of this before #212, spread across the two sibling tabs of the profile page, and every one rolled back in silence. The first attempt migrated only `FeaturesForm` and left `PreferencesForm` behind, which is the argument for one path rather than a convention to follow. `PrivacyProvider` keeps `hideAmounts` in its own state rather than in `UserInfo`, so it applies the same rule by hand instead of through the hook — it previously did not check the response at all, leaving the UI disagreeing with the database until the next reload. Note `ToastProvider` sits **outside** `PrivacyProvider` in `(app)/layout.tsx` for exactly this: nested the other way, `useToast` resolves to the no-op context default and the failure message is itself dropped in silence

## Code Style
- TypeScript over JS
- Named exports except framework defaults (Next.js pages/layouts)
- `function` for components, arrows for utilities
- `const` default, `let` when needed, never `var`. `unknown` over `any`
- Files: `kebab-case` | Components: `PascalCase` | Vars/functions: `camelCase` | Constants: `UPPER_SNAKE` | DB columns: `snake_case`
- Functions ≤ 50 lines, components ≤ 150 lines
- No `console.log` in commits. Handle loading/error/empty states
- Tailwind CSS utility classes directly — avoid `@apply` unless necessary
- `pnpm` as package manager. Node 20.19+ (Vite 8, jsdom and `@vitejs/plugin-react` all floor at `^20.19.0`; below that `pnpm test` fails inside the pool worker rather than at install)
- Run `pnpm lint`, `pnpm type-check`, and `pnpm test` before finishing any code changes
- When touching `src/lib/budget-queries.ts` or `src/lib/budget-query-types.ts`, also run `cd mcp-server && pnpm type-check`. The root type-check excludes `mcp-server`, so a signature change there compiles clean while breaking the MCP server

## Rule Strictness
- **Hard requirements** (must pass): TypeScript, naming conventions, no `console.log` in commits (CLI scripts under `scripts/` may print — they have no other output channel; see `heal-bill-next-due-dates.ts`, `generate-pwa-icons.ts`, `prisma/seed.ts`), `pnpm` usage, and successful `pnpm lint` + `pnpm type-check` + `pnpm test`
- **Strong preferences** (use judgment): function/component size targets (≤ 50/150 lines), utility style choices, and minimizing `@apply`
- If a strong preference conflicts with clarity or maintainability, prefer clearer code and document the tradeoff in your PR notes

## PR Checklist
- Lint, type-check, and tests pass locally (`pnpm lint`, `pnpm type-check`, `pnpm test`)
- New/changed behavior includes tests, or a short manual test plan where a test is impractical
- No secrets or local-only environment values are committed
- Loading, error, and empty states are handled for affected UI
- Update docs/changelog when behavior, routes, or setup changes

## Next.js Version Note
- Current baseline is **Next.js 15 (App Router)** in this repo
- If adopting Next.js 16 conventions/features, do so in isolated PRs and document migration impact (routing/auth/middleware/cache behavior) before broad rollout
- Avoid mixing 15/16 patterns in the same feature PR unless required for compatibility

## Changelog
See [CHANGELOG.md](CHANGELOG.md) for full development history and feature log.
