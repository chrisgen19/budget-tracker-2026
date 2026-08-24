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
│   ├── schedule-matching.ts   # Pure schedule-matching utility (shared client/server)
│   ├── schedule-server.ts     # Server-side schedule helpers (Prisma queries + matching)
│   ├── query-client.ts     # TanStack Query client factory
│   ├── utils.ts            # General utilities
│   ├── validations.ts      # Zod schemas
│   └── index.ts            # Re-exports
├── types/                  # TypeScript type definitions
└── mcp-server/             # Standalone MCP server for Claude Desktop integration
    └── src/index.ts        # 12 read-only MCP tools over stdio
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
- `GEMINI_MODEL` — Optional; Gemini model for receipt scanning (defaults to `gemini-2.5-flash`)
- `GEMINI_FALLBACK_MODEL` — Optional; model retried once when the primary stays overloaded (503) after retries (defaults to `gemini-2.5-flash`; `""` disables fallback)
- `GEMINI_THINKING_BUDGET` — Optional; thinking budget for **Gemini 2.x** models. `-1` = dynamic thinking (default, best quality), `0` = off (speed mode), `128`-`24576` = fixed token budget
- `GEMINI_THINKING_LEVEL` — Optional; thinking level for **Gemini 3+** models (they use `thinkingLevel`, not `thinkingBudget`): `minimal` (speed mode) | `low` | `medium` (default, best quality) | `high`
- `GEMINI_TIMEOUT_MS` — Optional; per-attempt request timeout in ms (default `60000`, `0` disables). Timed-out attempts are retried like 503s. Lower it (e.g. `30000`) when running speed mode
- `RESEND_API_KEY` — Email sending (verification + password reset)
- `EMAIL_FROM` — Sender address (optional; defaults to `Budget Tracker <noreply@resend.dev>` if unset). Use a verified Resend domain in production, e.g. `Budget Tracker <noreply@yourdomain.com>`.
- `AUTH_URL` — Optional; used in preview/staging deployments
- `CRON_SECRET` — Shared secret required by `/api/cron/bill-reminders`. Set in the production (Coolify) environment; a Coolify Scheduled Task reuses the same env var to call the endpoint daily (see **Cron Jobs** below).
- `AI_ASSESSMENT_DAILY_LIMIT` — Optional; max AI Assessment report generations per user per day (default `10`). The grounded report makes 2 Gemini calls per generation; cached reports and the daily tip don't count against it.

## Cron Jobs
Production runs on Coolify. Schedules are configured in the Coolify dashboard under **Application > Scheduled Tasks** (not in the repo). Each task runs its command inside the running container, so it can hit the app at `http://localhost:3000` and reuse the container's env vars.

Active tasks:
- **Bill reminders** — daily at `0 21 * * *` UTC (05:00 Asia/Manila); command: `curl -sS -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/bill-reminders`

## Database
- `DATABASE_URL` in `.env` points to local PostgreSQL
- Default categories are seeded (15 total: 10 expense, 5 income)
- Users can create custom categories on top of defaults
- Key models: `User`, `Category`, `Transaction`, `ScheduledTransaction` (recurring bills; `@@map("scheduled_transactions")` — there is no `Bill` model), `ScheduledTransactionLog` (per-occurrence PAID/SKIPPED/SNOOZED), `BillEmailLog`, `Label`, `LabelSchedule`, `TransactionLabel`, `BillLabel`, `VerificationToken`, `ScanLog`, `AiAssessment`, `AiUsageLog`, `AppSettings`
- Notable columns: `users.hide_amounts`, `users.timezone_offset`, `users.email_verified`, `users.default_label_type`, `transactions.receipt_group_id`, `transactions.receipt_breakdown`, `transactions.bill_id`, `transactions.client_batch_id`
- `Label.applicable_to` restricts labels to "EXPENSE", "INCOME", or "BOTH" (default); filters LabelPicker, schedule auto-labeling, and retroactive apply
- `LabelSchedule` stores per-label auto-apply rules: `days` (int[]), `startTime`/`endTime` (HH:mm), linked to `Label` via `labelId`

## Testing
- **Vitest + React Testing Library**, jsdom environment. Config in `vitest.config.mts`, global setup in `vitest.setup.ts` (RTL cleanup, and the `matchMedia`/`scrollTo` stubs jsdom lacks)
- **Node floor**: CI and production both run Node 20 (`nixpacks.toml`), so test dependencies have to admit it. `jsdom` stays on 29.x and `@testing-library/jest-dom` is not installed at all — both 30.x and 7.x floor at Node 22. CI installs with `--engine-strict` so a dependency that excludes the Node version fails at install with a named cause, rather than crashing later inside a test worker
- Tests are colocated: `src/**/*.test.ts(x)`. Nothing imports them, so they stay out of the Next.js bundle
- Import test globals explicitly (`import { describe, it, expect } from "vitest"`) rather than enabling `globals`
- A test should fail if you revert the fix it covers. When adding one for a bug, confirm that before committing
- `scripts/verify-scan-quota.ts` remains separate: it needs a real PostgreSQL database (advisory locks, transaction isolation) that jsdom cannot provide. Run it directly with `pnpm exec tsx`

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
- **Receipt scan quota** (`src/lib/scan-quota.ts`) — a credit is reserved *before* the Gemini call and settled after: `SUCCESS` spends it, `FAILED` refunds it, so users are never charged for a scan they can't use. Reservations serialise per user with a Postgres advisory lock (a bare count-then-insert cannot enforce a limit under READ COMMITTED). Because refunds mean the monthly limit no longer bounds API spend, a rolling attempt rate limit does. `FAILED` rows are kept, not deleted, so refunded attempts still count toward it
- **Receipt itemization** — multi-scan groups transactions by `receiptGroupId`; per-transaction `receiptBreakdown` JSON stores individual line items for each category
- **AI Assessment** (`src/lib/ai-assessment.ts`) — Gemini turns the analytics page's already-computed `AnalyticsData` into a personalized report; two parallel calls (structured data analysis + grounded web tips via Google Search), cached per period in `AiAssessment`, metered by `AiUsageLog`. Prose is privacy-safe by construction (relative/percentage language, not raw amounts)
- **TanStack React Query** — all data fetching uses React Query; `queryKeys` object in each query hook scopes cache invalidation; `query-client.ts` exports a factory (needed for server/client separation)
- **Shared budget queries** (`src/lib/budget-queries.ts`) — dependency-injected Prisma functions shared between API routes and the MCP server
- **Label schedules** — labels can have time-of-day + day-of-week schedules that auto-tag transactions; pure matching in `schedule-matching.ts`, server helpers in `schedule-server.ts`, client hook in `use-scheduled-label.ts`; first-created label wins on overlap; `labelIds: undefined` = server auto-applies, `labelIds: []` = user opted out
- **Label type restrictions** — labels have `applicableTo` ("EXPENSE" | "INCOME" | "BOTH"); LabelPicker filters by transaction type; schedule auto-labeling respects type; narrowing type on edit triggers 409 confirmation to remove affected associations; default controlled by `users.default_label_type` preference
- **Timezone offsets** — all date-range queries accept a `timezoneOffset` (minutes, `getTimezoneOffset()` convention so UTC+8 is -480) for correct day/month boundaries; offset stored in `users.timezone_offset` and provided by `UserProvider`. One formula app-wide, `Date.UTC(y, m, d) + tzOffset * 60000` (see `/api/dashboard`, `analytics-period.ts`, and `parseMonth` in `budget-queries.ts`). In `budget-queries.ts` the param is optional and defaults to UTC, so **a caller that forgets it gets silently wrong months rather than a type error** — pass it explicitly from anything that has a user
- **MCP server** (`mcp-server/`) — standalone package; runs via `tsx` over stdio; tools register with `registerTool` and all 8 declare `annotations: { readOnlyHint: true }`, which lets clients auto-approve them (the server has no write path); user ID injected via `BUDGET_USER_ID` env var, resolved once at startup so an unknown id exits with a named error instead of serving zeros, and reused for the user's `timezoneOffset`; excluded from root `tsconfig.json`, so it has its own `pnpm type-check` that CI runs separately. Standalone in its dependency tree only: it imports `src/lib/budget-queries.ts` and declares `@prisma/client` as `link:../node_modules/@prisma/client`, sharing the app's generated client rather than generating a second one. `zod` is pinned to the app's 3.x line on purpose: leaving it undeclared let pnpm auto-install zod 4 as an SDK peer, which type-checked the file against a different major than it ran on and made `tsc` exhaust the heap (`TS2589`). It also carries its own `.npmrc`, since npm config is read from the install cwd and the root hardening does not reach it

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
- `POST /api/receipts/scan` — Gemini OCR for single receipt; reserves a scan credit before the AI call and refunds it if the scan fails (403 over quota, 429 rate limited, 413 body too large)
- `POST /api/receipts/breakdown` — Gemini itemization by category for multi-scan; same credit reservation and refund rules as `/scan`
- `GET/PATCH /api/preferences` — read/toggle user preferences (hide_amounts, etc.)
- `GET /api/profile` — user profile info
- `GET /api/email/verify` — validate email verification token
- `POST /api/email/forgot-password` — send password reset email
- `POST /api/email/reset-password` — validate token + update password
- `POST /api/resend-verification` — resend verification email
- `GET /api/cron/bill-reminders` — sends email reminders for pending bills (secured with `CRON_SECRET`); triggered daily by a Coolify Scheduled Task on production
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
