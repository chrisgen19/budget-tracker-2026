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
│   │   ├── profile/        # User profile + feature settings
│   │   └── admin/          # Admin panel (settings)
│   └── api/                # REST API routes
├── components/
│   ├── ui/                 # Shared UI: Modal, EmptyState, IconMap, MobileFab, ConfirmModal, Toast, DropdownButton
│   ├── analytics/          # Analytics charts (IncomeExpenses, CashFlow, CategoryBreakdown, LabelBreakdown)
│   ├── dashboard/          # Chart components
│   ├── transactions/       # Transaction form, LabelPicker, ReceiptBreakdown
│   ├── labels/             # LabelForm (with schedule config)
│   ├── categories/         # Category form
│   ├── bills/              # BillForm, BillReminderBanner, BillReminderProvider
│   ├── pwa/                # InstallPromptBanner, OfflineBanner, InstallBannerContext
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
│   ├── scan-quota.ts       # Receipt scan credit reservation, refund, and rate limit
│   ├── receipt-guard.ts    # Shared upload validation + permission gate for receipt routes
│   ├── budget-queries.ts   # Shared read-only Prisma query functions (used by app + MCP)
│   ├── budget-query-types.ts  # TypeScript types for budget queries
│   ├── mcp/                # Shared MCP tool definitions, scopes, and bearer token auth
│   ├── schedule-matching.ts   # Pure schedule-matching utility (shared client/server)
│   ├── schedule-server.ts     # Server-side schedule helpers (Prisma queries + matching)
│   ├── query-client.ts     # TanStack Query client factory
│   ├── utils.ts            # General utilities
│   ├── validations.ts      # Zod schemas
│   └── index.ts            # Re-exports
├── types/                  # TypeScript type definitions
└── mcp-server/             # stdio entry point for the MCP server (local Claude Desktop)
    └── src/index.ts        # Thin wrapper; the 12 tools live in src/lib/mcp/server.ts
```

## Commands
- `pnpm dev` — Start dev server (Turbopack)
- `pnpm build` — Production build (generates Prisma client + runs migrations + Next.js build)
- `pnpm lint` — Run ESLint
- `pnpm type-check` — Run TypeScript type checker
- `pnpm test` — Run the test suite once (CI mode)
- `pnpm test:watch` — Run tests in watch mode
- `pnpm db:migrate` — Run Prisma migrations (dev)
- `pnpm db:push` — Push schema changes without migration file
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
- `CRON_SECRET` — Shared secret required by `/api/cron/bill-reminders`. Set in the production (Coolify) environment; a Coolify Scheduled Task reuses the same env var to call the endpoint daily (see **Cron Jobs** below).
- `TELEGRAM_BOT_ENABLED`: starts the bot from `src/instrumentation.ts` on server boot. Set it **only** in the deployed environment: Telegram answers a second concurrent `getUpdates` for one bot token with 409 Conflict, so enabling it locally while production runs the bot makes the two fight. Use `pnpm telegram:bot` to run it locally instead, and not at the same time
- `TELEGRAM_BOT_TOKEN`: from @BotFather
- `TELEGRAM_ALLOWED_IDS` / `TELEGRAM_ALLOWED_USERNAMES`: who may message the bot. With neither set it serves nobody. Prefer numeric ids: usernames are weaker, since a released handle can be claimed by someone else
- `TELEGRAM_MCP_URL` / `TELEGRAM_MCP_TOKEN`: where the bot writes. The URL is **required and has no default**: it used to fall back to this project's production domain, which is correct for its owner and a trap for a fork or a staging deploy that forgets it, since a write-capable token would then be sent to a host the deployer does not control. The port differs by how it runs: `http://localhost:3111/api/mcp` for `pnpm dev` plus `pnpm telegram:bot`, `http://localhost:3000/api/mcp` inside the deployed container (`next start`), or the public URL when the bot runs on a different machine from the app. Mint the token in Profile > MCP Access with all seven scopes the handlers need: `budget:read`, `transactions:read`, `labels:read`, `bills:read`, `receipts:read`, `receipts:scan` and `transactions:write`. A write-only token fails on every message, since each one reads the category list first, and the probe names anything missing at startup. Give the bot its own token so revoking it does not break another client
- `TELEGRAM_TZ_OFFSET`: **required, no default**. Minutes, `getTimezoneOffset()` convention, and it must match the account's own timezone. It used to fall back to the host's offset, which is UTC in the app container, so "yesterday" silently resolved to the wrong day. Used to resolve relative dates for Gemini and to render the day in `/recent`; every query and write is still resolved server-side against `users.timezone_offset`, so a wrong value cannot move a stored row, only mislabel one before it is written. That it duplicates `users.timezone_offset` at all is the real defect and can drift: see issue #132
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
is worse than none, so a test asserts every listed command is one the bot handles. Obvious phrasings
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

## Cron Jobs
Production runs on Coolify. Schedules are configured in the Coolify dashboard under **Application > Scheduled Tasks** (not in the repo). Each task runs its command inside the running container, so it can hit the app at `http://localhost:3000` and reuse the container's env vars.

Active tasks:
- **Bill reminders** — daily at `0 21 * * *` UTC (05:00 Asia/Manila); command: `curl -sS -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/bill-reminders`

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
- `pnpm db:seed` is **not** part of a deploy. `pnpm build` is `prisma generate && prisma migrate deploy
  && next build`, and `nixpacks.toml` runs only that, so merging a change to the seed list ships the
  new prompts while the categories they route to do not exist yet. Run the seed by hand from a
  Coolify terminal after deploying one. Do not add it to the build command: it would run on every
  deploy, and the merge script below must never run unattended. `tsx` is a devDependency and may be
  absent from the standalone image, so run `merge-custom-category-into-default.ts` locally against
  the production `DATABASE_URL` if the container cannot; inside the container drop `--env-file`,
  since the variables are already set
- Removing a name from `DEFAULT_CATEGORIES` does not delete the row it already created. The leftover
  keeps `isDefault: true`, and `DELETE /api/categories/[id]` filters on `isDefault: false`, so it
  cannot be removed through the app. The seed reports these (`findOrphanedDefaults`) rather than
  repairing them: renaming one preserves its id and its transactions, but also relabels real spending
- Users can create custom categories on top of defaults
- Key models: `User`, `Category`, `Transaction`, `ScheduledTransaction` (recurring bills; `@@map("scheduled_transactions")` — there is no `Bill` model), `ScheduledTransactionLog` (per-occurrence PAID/SKIPPED/SNOOZED), `BillEmailLog`, `Label`, `LabelSchedule`, `TransactionLabel`, `BillLabel`, `VerificationToken`, `ScanLog`, `AiAssessment`, `AiUsageLog`, `McpToken`, `AppSettings`
- Notable columns: `users.hide_amounts`, `users.timezone_offset`, `users.email_verified`, `users.default_label_type`, `transactions.receipt_group_id`, `transactions.receipt_breakdown`, `transactions.bill_id`, `transactions.client_batch_id`, `transactions.created_via`, `transactions.mcp_token_id`, `users.mcp_writes_enabled_until`, `mcp_tokens.source`
- `Label.applicable_to` restricts labels to "EXPENSE", "INCOME", or "BOTH" (default); filters LabelPicker, schedule auto-labeling, and retroactive apply
- `LabelSchedule` stores per-label auto-apply rules: `days` (int[]), `startTime`/`endTime` (HH:mm), linked to `Label` via `labelId`

## Testing
- **Vitest + React Testing Library**, jsdom environment. Config in `vitest.config.mts`, global setup in `vitest.setup.ts` (RTL cleanup, and the `matchMedia`/`scrollTo` stubs jsdom lacks)
- **Node floor**: CI and production both run Node 20 (`nixpacks.toml`), so test dependencies have to admit it. `jsdom` stays on 29.x and `@testing-library/jest-dom` is not installed at all — both 30.x and 7.x floor at Node 22. CI installs with `--engine-strict` so a dependency that excludes the Node version fails at install with a named cause, rather than crashing later inside a test worker
- Tests are colocated: `src/**/*.test.ts(x)`. Nothing imports them, so they stay out of the Next.js bundle
- Import test globals explicitly (`import { describe, it, expect } from "vitest"`) rather than enabling `globals`
- A test should fail if you revert the fix it covers. When adding one for a bug, confirm that before committing
- `scripts/verify-scan-quota.ts` and `scripts/verify-mcp-token-auth.ts` remain separate: they need a real PostgreSQL database (advisory locks, row locks, transaction isolation, timestamp marshalling) that jsdom cannot provide. Run them directly with `pnpm exec tsx`. `verify-mcp-token-auth.ts` needs a **non-UTC** database timezone and fails loudly on a UTC one: the regression its rate-limit checks cover only appears when the session zone is not UTC, so a green run against UTC would prove nothing
- `scripts/verify-token-delete.ts` proves that deleting an MCP token removes the credential and leaves the transactions it wrote untouched. The property worth pinning is the absence of a cascade: `transactions.mcp_token_id` is deliberately not a foreign key, and a schema change that made one would delete a user's transactions during a tidy-up with no unit test noticing
- `scripts/verify-receipt-scan.ts` drives `scan_receipt` over the real endpoint with a real Gemini call, and checks the scan-credit accounting: a refused call reserves nothing, a non-receipt is refunded but keeps its `FAILED` row for the rate limit, and a usable scan spends exactly one credit and writes no transaction. It creates and deletes its own throwaway user, so it never touches yours. Pass `RECEIPT=/path/to/receipt.jpg` to also exercise a successful scan; without it the non-receipt path still covers the whole pipeline. It found two bugs no unit test did, so run it after touching the scan path
- `scripts/verify-mcp-endpoint.ts` drives the real `/api/mcp` route with the SDK's own HTTP client against a dev server: `pnpm dev -p 3111` then `BASE_URL=http://localhost:3111 pnpm exec tsx scripts/verify-mcp-endpoint.ts`

## Key Patterns
- **PrivacyProvider** (`src/components/privacy-provider.tsx`) — shared hide-amounts state across all app pages, persisted in DB via `/api/preferences`
- **UserProvider** (`src/components/user-provider.tsx`) — reactive user info (name, email, currency, receiptScanEnabled, timezoneOffset) shared across components
- **ScanProvider** (`src/components/scan-provider.tsx`) — receipt capture state (captured images, scan results, multi-scan queue)
- **BillReminderProvider** (`src/components/bills/bill-reminder-provider.tsx`) — manages upcoming/overdue bill banners across the app
- **App layout** (`src/app/(app)/layout.tsx`) wraps pages with `Providers > PrivacyProvider > AppShell`
- **MobileFab** (`src/components/ui/mobile-fab.tsx`) — shared FAB component used on dashboard, transactions, categories, and bills; auto-accounts for install banner height via `ResizeObserver`
- **ConfirmModal** (`src/components/ui/confirm-modal.tsx`) — reusable delete/deactivate confirmation dialog
- **Modal** (`src/components/ui/modal.tsx`) — uses `visualViewport` API for keyboard-aware positioning on iOS Safari
- **Receipt scanning** is opt-in per user — toggled in Profile Settings > Features; uses Gemini AI for OCR and per-category itemization
- **Unacknowledged saves** — a failed batch save is classified by whether anything could have been written. A 4xx is raised before the route opens a transaction, so nothing was: the queue is free to be corrected and resubmitted as a new intent. A 5xx or a lost response is *unknown*, so the rows are pinned, frozen in the review, and the retry replays them under the same key. Editing a frozen row would be discarded by the replay, so the UI does not offer it
- **Idempotent batch save** — `POST /api/transactions/batch` accepts a `clientBatchId`. A batch that commits but whose response is lost is indistinguishable from one that never ran, and the multi-scan review invites a retry, which would post every receipt again. The key is held client-side across a failure so the retry replays, and cleared once a save lands. Serialised with a `pg_advisory_xact_lock` on the key so a double submit cannot race the existence check. Verified by `scripts/verify-batch-idempotency.ts`, which drives the real HTTP route against a dev server (`BASE_URL=http://localhost:3111 pnpm exec tsx scripts/verify-batch-idempotency.ts`)
- **Receipt year repair** (`src/lib/receipt-date.ts`): `checkReceiptDate` normally warns about a suspicious year without touching it, but overrides one readable case — when the OCR year disagrees with the photo's while the month and day match it *exactly*. That signature is a misread digit, not an old receipt, since reading a different date wrong almost never lands on the photo's month and day; it was seen in production as `08/26/2026` read back as `2023-08-26`. A repair always sets `dateWarning` and reports `repairedFromYear`, which the review renders as "year corrected from 2023" and `scan_receipt` states in prose, because an inference the user cannot see is one they cannot undo. Deliberately narrow: "same month" or "within a few days" would start rewriting dates that were read correctly. Note this is the one place a *readable* receipt date is influenced by the photo date, narrowing the rule below
- **Photo capture dates** (`src/lib/exif-date.ts`): `readPhotoTakenAt` pulls EXIF `DateTimeOriginal` out of JPEG/HEIC bytes with no dependency, since the tag is fixed-width ASCII inside a standard TIFF block that both formats embed. The Telegram bot has no `File.lastModified` to read, so an unreadable receipt date used to fall back to *today*, putting a receipt photographed days earlier on the day it was uploaded. EXIF timestamps carry no timezone by specification, which is exactly the offset-less shape `resolveTransactionDate` wants; appending a `Z` would claim UTC. It survives only when the image is sent as a **file**, since Telegram re-encodes photos and strips metadata. Used whole rather than as a bare date, so the timestamp is real and label schedules can run against it instead of an invented clock
- **Review buttons** (`src/lib/telegram/callback-data.ts`) — the receipt review carries Save/Discard inline buttons. A press arrives as a `callback_query`, which the poll loop used to drop, and is gated by `callbackIsAllowed` rather than `messageIsAllowed`: the shape differs, and a message with buttons can be forwarded, so what is authenticated is *who tapped it*. `callback_data` carries the photo's `updateId` and the handler refuses a press whose id does not match the pending scan — buttons never expire from chat history, so an old review stays tappable and would otherwise confirm whichever scan is pending now, showing one amount and saving another. Buttons are removed once answered *however* it was answered: `PendingScan.reviewMessageId` holds the review's message id so a typed yes or no clears the keyboard too, which is why `sendMessage` returns the id rather than a boolean. Leaving it live on an answered review meant a later tap reported the receipt as expired — true of the draft, misleading about the receipt, which had been saved. `answerCallbackQuery` is best-effort so a spinner never costs the action, and typing `yes`/`no` still works because corrections need free text anyway
- **Correcting a scan at the review** (`src/lib/telegram/scan-correction.ts`) — a reply to the review that is not yes/no replaces the description and re-shows it, still unsaved. Nothing is re-scanned: the user supplied the words themselves, and `scan_receipt` is not idempotent, so a second read would spend another credit for a field already known. Defined by *exclusion* — a reply is a correction only when it is not a confirmation, not amount-first (the shorthand logger keeps those), and not a command — because a description has no recognisable shape and the fall-through it replaces was deliberate. `revisePendingScan` leaves `updateId` untouched so the corrected save still replays the photo's batch key rather than writing a second row. A draft restored after an **unsettled** write is `frozen` and refuses corrections, for the same reason the web app freezes a pinned row: the retry replays the same key, so if the first write did commit the server returns the original and the edit vanishes. A deterministic refusal — a lapsed write lease is the common one — is raised before anything is written, so that draft stays editable
- **Receipt captions** — free text sent with a photo reaches `scanReceipt` as a `caption` and is quoted into the prompt as a *hint*, capped at `MAX_CAPTION_CHARS`. Deliberately not applied afterwards as a description override: "here you go" is an ordinary thing to send with a photo, and pasting it over a correctly-read merchant name is worse than ignoring it, whereas the model can weigh it against what it reads. It is also the only route by which the caption can reach `categoryId`, which is the field OCR most often gets wrong and which a post-hoc description swap could never help. The receipt wins on conflict, and the prompt tells the model to read `amount` and `date` from the image alone. That is a steer, not a guarantee — prose cannot bind a model, and a caption naming a figure could in principle be echoed into `amount`. What actually protects those two fields is the confirmation step, which receipt scanning has always required for precisely this reason: OCR on a crumpled phone photo is where a wrong amount comes from, so nothing is written until the user has seen it. The caption sits *below* the category rules and above only the response format, so it cannot appear to re-scope the rules it must not override. The Telegram review says "I used your caption as a hint" when one was sent, on the same principle as the repaired receipt year: an inference the user cannot see is one they cannot undo
- **Receipt scanning over MCP** (`src/lib/receipt-scan.ts`): `scanReceipt` is the single scan path, shared by `POST /api/receipts/scan` and the MCP `scan_receipt` tool, so the role gate, the monthly cap, the rate limit and the reserve/refund all apply to both. The tool returns a *draft* and writes nothing: saving still goes through `create_transactions`, which keeps one create path. `receipts:scan` is a **privileged** scope even though it writes nothing, because each call spends a metered, paid resource: `isWriteScope` tests `endsWith(":write")`, so without `isPrivilegedScope` it would have fallen into `READ_ONLY_SCOPES`, which is the default grant and what the local stdio server runs with. `receipt-scan.ts` is imported dynamically inside the tool handler, since it pulls in `gemini.ts`, which builds its client on load and throws without `GEMINI_API_KEY`
- **Receipt scan quota** (`src/lib/scan-quota.ts`) — a credit is reserved *before* the Gemini call and settled after: `SUCCESS` spends it, `FAILED` refunds it, so users are never charged for a scan they can't use. Reservations serialise per user with a Postgres advisory lock (a bare count-then-insert cannot enforce a limit under READ COMMITTED). Because refunds mean the monthly limit no longer bounds API spend, a rolling attempt rate limit does. `FAILED` rows are kept, not deleted, so refunded attempts still count toward it
- **Receipt itemization** — multi-scan groups transactions by `receiptGroupId`; per-transaction `receiptBreakdown` JSON stores individual line items for each category
- **AI Assessment** (`src/lib/ai-assessment.ts`) — Gemini turns the analytics page's already-computed `AnalyticsData` into a personalized report; two parallel calls (structured data analysis + grounded web tips via Google Search), cached per period in `AiAssessment`, metered by `AiUsageLog`. Prose is privacy-safe by construction (relative/percentage language, not raw amounts)
- **TanStack React Query** — all data fetching uses React Query; `queryKeys` object in each query hook scopes cache invalidation; `query-client.ts` exports a factory (needed for server/client separation)
- **Shared transaction writes** (`src/lib/transaction-writes.ts`): `createTransactionBatch` is the single create path, injected with `prisma` and shared by `POST /api/transactions/batch` and the MCP `create_transactions` tool. It owns the advisory-lock idempotency, the label resolution rules (`undefined` auto-labels, `[]` opts out, explicit ids are deduped and type-filtered), and the category-ownership check. A second copy would drift the moment either changed
- **MCP writes** are gated by three independent controls, none of which substitutes for another: the `transactions:write` scope (least privilege, fixed at mint, and such a token may not choose "Never" and is capped at 90 days), `users.mcp_writes_enabled_until` (a *lease*, not a boolean, so forgetting to switch it off cannot leave writes open for days), and `transactions.created_via` + `mcp_token_id` (audit, set server-side so a compromised token cannot forge or omit it). Provenance follows the *credential*, not the endpoint: `mcp_tokens.source` is chosen at mint ("AI assistant" or "Telegram bot") and stamped onto every row that token writes, because every remote write arrives through `/api/mcp` and deriving it from the endpoint made the Telegram bot's rows claim Claude wrote them. `APP` is not mintable, so a token can never make a row look hand-typed. Provenance is a column and not a label because `getLabelBreakdown` splits an amount evenly across a transaction's labels, so a provenance label would divert half of every MCP-written expense out of its real category, and labels are user-deletable
- **Shared budget queries** (`src/lib/budget-queries.ts`) — dependency-injected Prisma functions shared between API routes and the MCP server
- **MCP and label schedules**: `create_transactions` lets a user's auto-apply schedules run, but only when the timestamp reflects reality (`hasTrustworthyTime`): a time the caller supplied, or a bare date that is *today* in the user's zone. A bare date is filled with the current clock, so a backdated row would otherwise carry an invented time, and a Tuesday dinner entered on a Wednesday morning would land inside a weekday 05:00-17:00 window and be tagged as work spending. An explicit `labelIds: []` always opts out
- **Label schedules** — labels can have time-of-day + day-of-week schedules that auto-tag transactions; pure matching in `schedule-matching.ts`, server helpers in `schedule-server.ts`, client hook in `use-scheduled-label.ts`; first-created label wins on overlap; `labelIds: undefined` = server auto-applies, `labelIds: []` = user opted out
- **Label type restrictions** — labels have `applicableTo` ("EXPENSE" | "INCOME" | "BOTH"); LabelPicker filters by transaction type; schedule auto-labeling respects type; narrowing type on edit triggers 409 confirmation to remove affected associations; default controlled by `users.default_label_type` preference
- **Remote MCP auth** (`src/lib/mcp/tokens.ts`): static bearer tokens, chosen over OAuth 2.1 in #123. NextAuth v4 is an OAuth *client*, not a server, so there is nothing to plug the SDK's auth handlers into; a full authorization server was not worth it while this is single-user. Works in Claude Desktop and Claude Code, which set request headers directly, and in claude.ai web/mobile wherever **request-header authentication** is enabled (`authorization` is on Anthropic's accepted header-name allowlist and the value is sent verbatim, so it must include the `Bearer ` prefix). That feature is in beta and rolled out on request, so an account without it is limited to the two desktop clients. The credential is accepted as `Authorization: Bearer <token>` or `X-Api-Key: <token>`; `Authorization` wins when both are sent. `X-Api-Key` is not redundant: clients that implement OAuth own the `Authorization` header, so Claude Desktop's connector dialog refuses that name and `mcp-remote` reacts to its 401 by starting dynamic client registration instead of using the static credential. Authenticating on the first request avoids emitting the 401 that starts either cascade, and `x-api-key:<token>` also has no space, which `mcp-remote` cannot parse in a `--header` argument. Only the SHA-256 of a token is stored (a 256-bit CSPRNG secret needs no password KDF, and the request has to look the row up *by* the digest). Tokens carry subject-area scopes, an optional expiry, and revocation; out-of-scope tools are removed from the server rather than rejected on call, so a scoped token never advertises what it cannot use
- **MCP rate limiting**: a fixed window per token, applied in one atomic `UPDATE` so concurrent requests serialise on the row lock instead of all reading the same pre-write count. Charged *before* the revoked/expired branches: revocation is the response to a leak, so a revoked token is precisely the one whose replay needs a ceiling. `rate_window_start` must hold UTC (Prisma supplies it; the column's generated `DEFAULT CURRENT_TIMESTAMP` resolves to the session zone, so never raw-`INSERT` this table without the column, and do not hand-edit that default: `prisma migrate diff` then reports permanent drift). Every instant is computed *inside* SQL: Prisma maps `DateTime` to `timestamp without time zone` holding UTC, but a `Date` bound into `$queryRaw` is sent as `timestamptz` and compared through the session timezone. Under Asia/Manila that made every window look 8 hours stale, so the limiter reset on each request and enforced nothing
- **Timezone offsets** — all date-range queries accept a `timezoneOffset` (minutes, `getTimezoneOffset()` convention so UTC+8 is -480) for correct day/month boundaries; offset stored in `users.timezone_offset` and provided by `UserProvider`. One formula app-wide, `Date.UTC(y, m, d) + tzOffset * 60000` (see `/api/dashboard`, `analytics-period.ts`, and `parseMonth` in `budget-queries.ts`). In `budget-queries.ts` the param is optional and defaults to UTC, so **a caller that forgets it gets silently wrong months rather than a type error** — pass it explicitly from anything that has a user
- **MCP server** (`src/lib/mcp/`, `mcp-server/`): the tools are defined once in `src/lib/mcp/server.ts` and served over two transports: `mcp-server/` is a thin stdio entry point for a locally spawned client, and `/api/mcp` serves the same server over Streamable HTTP for a remote one. A second copy of the registrations would drift the moment a tool changed on either side, and nothing would catch it. `mcp-server/` is a standalone package; runs via `tsx` over stdio; every tool declares an `outputSchema` and returns both `content` and `structuredContent`. The SDK does **not** validate `structuredContent` against the schema, so `output-schemas.ts` pins each schema to the query layer's type with a compile-time `assertExact`; drift fails `pnpm type-check` instead of silently misinforming clients; tools register with `registerTool`; the 12 read tools declare `annotations: { readOnlyHint: true }`, which lets clients auto-approve them, and `create_transactions` deliberately does **not**, so clients prompt before each write; user ID injected via `BUDGET_USER_ID` env var, resolved once at startup so an unknown id exits with a named error instead of serving zeros, and reused for the user's `timezoneOffset`; excluded from root `tsconfig.json`, so it has its own `pnpm type-check` that CI runs separately. Standalone in its dependency tree only: it imports from `src/lib/` and declares `@prisma/client`, `@modelcontextprotocol/sdk` and `zod` as `link:../node_modules/…`, sharing the app's copies rather than resolving second ones. Linking is what makes the shared registration safe: a file under `src/lib/` resolves its imports from the *root* `node_modules` whichever entry point loaded it, so a separately installed SDK here would put two different `McpServer` classes in one process. It also settles the `zod` hazard that pinning `^3.24.0` used to cover: leaving zod undeclared let pnpm auto-install zod 4 as an SDK peer, which type-checked the file against a different major than it ran on and made `tsc` exhaust the heap (`TS2589`). It also carries its own `.npmrc`, since npm config is read from the install cwd and the root hardening does not reach it

## API Routes Reference
- `POST /api/register` — registration with bcrypt + sends verification email
- `GET/POST /api/transactions` — list (filters/pagination/timezone) + create
- `PUT/DELETE /api/transactions/[id]` — update/delete (ownership check)
- `GET /api/analytics` — analytics data (income/expenses, category/label breakdowns, cash flow) with granularity, date range, timezone, and type filter params
- `GET /api/assessment` — cached AI Assessment report for a period (`granularity`/`from`/`to`); returns `{ report | null, generatedAt, model }`
- `POST /api/assessment/generate` — generate/refresh the AI report for a period (Gemini structured analysis + grounded web tips); caches it and enforces a per-day cap
- `GET /api/assessment/daily-tip` — today's lightweight AI save/earn tip (lazily generated + cached per local day)
- `GET /api/dashboard` — aggregated stats, category breakdown, monthly trends
- `GET/POST /api/categories` — list (defaults + custom) + create
- `PUT/DELETE /api/categories/[id]` — update/delete (custom only)
- `GET/POST /api/bills` — list + create bills
- `PUT/DELETE /api/bills/[id]` — update/deactivate bills
- `GET /api/bills/upcoming` — bills due within 30 days
- `POST /api/bills/[id]/pay` — pay bill: creates transaction + advances next due date
- `GET/POST /api/labels` — list (with schedules) + create labels
- `PUT/DELETE /api/labels/[id]` — update/delete labels (ownership check)
- `POST /api/labels/[id]/apply` — retroactively apply schedule to existing transactions
- `POST /api/transactions/batch` — batch create/delete transactions (with auto-labeling); accepts an optional `clientBatchId` UUID that makes the create idempotent, returning 200 with the original rows on a replay instead of 201
- `POST /api/receipts/scan` — Gemini OCR for single receipt (thin wrapper over `scanReceipt` in `src/lib/receipt-scan.ts`, shared with MCP); reserves a scan credit before the AI call and refunds it if the scan fails (403 over quota, 429 rate limited, 413 body too large)
- `POST /api/receipts/breakdown` — Gemini itemization by category for multi-scan; same credit reservation and refund rules as `/scan`
- `GET/PATCH /api/preferences` — read/toggle user preferences (hide_amounts, etc.)
- `GET /api/profile` — user profile info
- `GET /api/email/verify` — validate email verification token
- `POST /api/email/forgot-password` — send password reset email
- `POST /api/email/reset-password` — validate token + update password
- `POST /api/resend-verification` — resend verification email
- `GET /api/cron/bill-reminders` — sends email reminders for pending bills (secured with `CRON_SECRET`); triggered daily by a Coolify Scheduled Task on production
- `POST|DELETE /api/mcp`: remote MCP endpoint over Streamable HTTP, authenticated by a static bearer token. Runs the transport stateless (a route handler has no process to pin a session to) and builds a per-request server narrowed to the token's scopes. `GET` deliberately returns **405**: serving the standalone SSE stream from a stateless route would pin an open request and a keep-alive timer per client on a transport nothing writes to, and the SDK client reads 405 as "no stream offered" and carries on over POST
- `GET/POST /api/mcp/tokens`: list + mint MCP tokens (NextAuth session); the plaintext is returned once and never stored
- `DELETE /api/mcp/tokens/[id]`: revoke a token (marks `revoked_at`, keeps the row for after-the-fact audit). `?permanent=true` deletes the row instead, and is refused with 409 on a token that is not already revoked, so removing a working credential takes two deliberate steps. Deleting cascades nothing: `transactions.mcp_token_id` is not a foreign key, so the rows a token wrote keep their provenance and only the name behind the id is lost
- `GET /api/health` — container liveness probe for the Coolify/Docker healthcheck; unauthenticated and deliberately touches no database (a deep check would restart every app on the shared Postgres during one blip)

## Design
- "Light & Warm" aesthetic with cream/paper-like backgrounds
- Fonts: Young Serif (headings) + Outfit (body)
- Color palette: warm browns, amber accents, green for income, red for expenses

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
