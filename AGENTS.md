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
│   │   ├── dashboard/      # Dashboard with charts, upcoming bills + quick-log strip
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
│   ├── dashboard/          # Chart components + QuickLogStrip (one-tap grid on the landing screen)
│   ├── transactions/       # Transaction form, LabelPicker, ReceiptBreakdown
│   ├── labels/             # LabelForm (schedules) + LabelCategoryPicker (category restriction)
│   ├── categories/         # Category form
│   ├── bills/              # BillForm, BillReminderBanner, BillReminderProvider
│   ├── pwa/                # InstallPromptBanner, OfflineBanner, InstallBannerContext
│   ├── telegram/           # Mini App: TelegramApp shell, TileGrid, AmountSheet, TileEditor
│   ├── quick-log/          # Web editor for the same tiles: QuickTileCard, QuickTileChip, QuickTileForm, AmountPrompt
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
│   ├── label-category-matching.ts  # Pure "may this label be used in this category?" predicate
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

## Detailed Rules

The area-specific material below lives in `.claude/rules/`, moved out of this file verbatim.
Claude Code injects a rule file automatically when you touch a file matching its `paths:`;
other agent tools do not load them, so open the file directly when you need the detail.

- **[.claude/rules/telegram.md](.claude/rules/telegram.md)**: the bot, the reply keyboard, the evening prompt, multi-shorthand, the Mini App grid, quick-log tiles and pinned labels, the dashboard strip and the log/manage split, the tap idempotency key, Frequent, and the `TELEGRAM_*` variables. Loads on `src/lib/telegram/**`, `src/app/tg/**`, `src/app/api/tg/**`, `src/components/telegram/**`, `src/app/(app)/quick-log/**`, `src/components/quick-log/**`, `src/lib/quick-tile-writes.ts`, `src/hooks/use-quick-tiles.ts`, `src/hooks/use-quick-tap.ts`, `src/components/dashboard/quick-log-strip*`, `src/lib/assessment-facts.ts`, `src/lib/gemini.ts`, `src/lib/validations.ts`, `src/components/profile/features-form.tsx`, `src/app/(app)/layout.tsx`, `src/app/api/preferences/**`, `src/app/api/quick-tiles/**`, `src/app/api/cron/telegram-prompts/**`, `src/instrumentation.ts`, `src/middleware.ts`, `src/middleware.test.ts`, `src/lib/protected-paths.ts`, `src/lib/protected-paths.test.ts`, `next.config.ts`, `scripts/telegram-bot.ts`, `scripts/link-telegram-user.ts`, `scripts/seed-telegram-quick-tiles.ts`, `e2e/telegram-mini-app.spec.ts`.
- **[.claude/rules/mcp.md](.claude/rules/mcp.md)**: the tool set and its two transports, scopes and the write lease, provenance columns, bearer-token auth, rate limiting, date windows and partial periods, and local calendar days on read rows. Loads on `src/lib/mcp/**`, `mcp-server/**`, `src/app/api/mcp/**`, `src/lib/budget-queries.ts`, `src/lib/budget-query-types.ts`, `src/lib/assessment-facts.ts`, `src/components/profile/mcp-*`, `src/app/api/preferences/**`, `src/app/api/transactions/**`, `src/app/api/labels/**`, `prisma/schema.prisma`, `prisma/migrations/**`, `src/lib/gemini.ts`.
- **[.claude/rules/transactions.md](.claude/rules/transactions.md)**: the shared create and update paths, the shared label-removal path, request body ceilings, idempotent batch saves, and label schedules, type restrictions and category restrictions. Loads on `src/lib/transaction-writes.ts`, `src/lib/label-writes.ts`, `src/lib/label-category-matching.ts`, `src/lib/request-size.ts`, `src/app/api/transactions/**`, `src/app/api/labels/**`, `src/lib/schedule-matching.ts`, `src/lib/schedule-server.ts`, `src/hooks/use-scheduled-label.ts`, `src/hooks/use-transactions.ts`, `src/hooks/use-multi-scan.ts`, `src/lib/receipt-limits.ts`, `src/components/transactions/**`, `src/lib/mcp/server.ts`, `src/lib/telegram/confirm-scan.ts`, `src/lib/telegram/bot.ts`, `src/app/api/mcp/**`.
- **[.claude/rules/bills.md](.claude/rules/bills.md)**: `settleBill` and the occurrence guard, `createBill`/`updateBill`, variable-amount forecasting, and why every bill date is UTC calendar-day arithmetic. Loads on `src/lib/bill-dates.ts`, `src/lib/bill-writes.ts`, `src/lib/bill-utils.ts`, `src/lib/bill-estimate.ts`, `src/app/api/bills/**`, `src/components/bills/**`, `src/lib/budget-queries.ts`, `src/lib/budget-query-types.ts`, `src/lib/pending-bills.ts`, `src/app/(app)/bills/**`, `src/app/api/cron/bill-reminders/**`, `src/hooks/use-bills.ts`, `src/components/dashboard/upcoming-bill-row.tsx`, `src/lib/mcp/server.ts`.
- **[.claude/rules/testing.md](.claude/rules/testing.md)**: the Vitest setup, the Node floor, and what each `scripts/verify-*.ts` proves that a stubbed test cannot. Loads on `scripts/**`, `**/*.test.ts`, `**/*.test.tsx`, `e2e/**`, `vitest.config.mts`, `vitest.setup.ts`, `package.json`, `pnpm-lock.yaml`.
- **[.claude/rules/assessment.md](.claude/rules/assessment.md)**: the deterministic facts half and the AI half, the coverage gate, and `AI_ASSESSMENT_DAILY_LIMIT`. Loads on `src/lib/assessment-facts.ts`, `src/lib/assessment-facts-query.ts`, `src/lib/ai-assessment.ts`, `src/app/api/assessment/**`, `scripts/assess.ts`, `scripts/refresh-local-mirror.ts`, `src/lib/validations.ts`, `src/components/analytics/assessment/**`, `src/components/analytics/ai-assessment-report.tsx`.
- **[.claude/rules/api-routes.md](.claude/rules/api-routes.md)**: the full API Routes Reference, every route the app exposes. Loads on `src/app/api/**`.
- **[.claude/rules/receipts.md](.claude/rules/receipts.md)**: scanning and itemization, the scan-credit quota, receipt year repair, EXIF capture dates, and captions as hints. Loads on `src/lib/receipt-scan.ts`, `src/lib/receipt-date.ts`, `src/lib/receipt-guard.ts`, `src/lib/scan-quota.ts`, `src/lib/exif-date.ts`, `src/app/api/receipts/**`, `src/components/scan-receipt-sheet.tsx`, `src/components/multi-scan-review.tsx`, `src/components/scan-provider.tsx`, `src/components/profile/features-form.tsx`, `src/app/api/preferences/**`, `src/lib/telegram/bot.ts`.
- **[.claude/rules/gemini.md](.claude/rules/gemini.md)**: the model, fallback, thinking and timeout variables that govern every AI call. Loads on `src/lib/gemini.ts`, `src/lib/receipt-scan.ts`, `src/lib/ai-assessment.ts`, `src/lib/gemini-limits.ts`, `src/app/api/receipts/**`, `src/lib/telegram/classify.ts`.

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
- `RESEND_API_KEY` — Email sending (verification + password reset)
- `EMAIL_FROM` — Sender address (optional; defaults to `Budget Tracker <noreply@resend.dev>` if unset). Use a verified Resend domain in production, e.g. `Budget Tracker <noreply@yourdomain.com>`.
- `AUTH_URL` — Optional; used in preview/staging deployments
- `ALLOW_REMOTE_DB` — Local only, and never set it in `.env`: `1` lets `pnpm db:migrate` / `pnpm db:push` run against a database that is not on this machine. The guard was written believing two migrations from the closed PR #187 had been applied straight to production from a dev machine; #192 established that a Vercel preview build did it. It is kept regardless — the accident it prevents is one keystroke away, it is simply not the one that happened — and this is the deliberate way past it, one command at a time (`ALLOW_REMOTE_DB=1 pnpm db:push`). Migrations otherwise reach production only by merging to main and letting Coolify deploy them
- `CRON_SECRET` — Shared secret required by `/api/cron/bill-reminders`. Set in the production (Coolify) environment; a Coolify Scheduled Task reuses the same env var to call the endpoint daily (see **Cron Jobs** below).

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
- Users can create custom categories on top of defaults
- Key models: `User`, `Category`, `Transaction`, `ScheduledTransaction` (recurring bills; `@@map("scheduled_transactions")` — there is no `Bill` model), `ScheduledTransactionLog` (per-occurrence PAID/SKIPPED/SNOOZED), `BillEmailLog`, `Label`, `LabelSchedule`, `LabelCategory`, `TransactionLabel`, `BillLabel`, `VerificationToken`, `ScanLog`, `AiAssessment`, `AiUsageLog`, `McpToken`, `AppSettings`, `TelegramPromptLog`, `TelegramQuickTile`, `TelegramQuickTileLabel`
- Notable columns: `users.hide_amounts`, `users.timezone_offset`, `users.telegram_user_id` (the Mini App's identity half; set by hand with `scripts/link-telegram-user.ts`, so a restored database loses it), `users.email_verified`, `users.default_label_type`, `transactions.receipt_group_id`, `transactions.receipt_breakdown`, `transactions.bill_id`, `transactions.client_batch_id`, `transactions.created_via`, `transactions.mcp_token_id`, `transactions.updated_via`, `transactions.updated_by_mcp_token_id`, `users.mcp_writes_enabled_until`, `mcp_tokens.source`
- `Label.applicable_to` restricts labels to "EXPENSE", "INCOME", or "BOTH" (default); filters LabelPicker, schedule auto-labeling, and retroactive apply
- `LabelCategory` (`label_categories`) restricts a label to chosen categories, composing with
  `applicable_to` rather than replacing it. **Zero rows means every category, not none** — that is
  what let it ship with no backfill, and `labelAllowsCategory` in `src/lib/label-category-matching.ts`
  is the only place the rule is written down. Cascades from both sides, so deleting a category can
  leave a label unrestricted again. See `.claude/rules/transactions.md` for where it refuses versus
  where it filters
- `LabelSchedule` stores per-label auto-apply rules: `days` (int[]), `startTime`/`endTime` (HH:mm), linked to `Label` via `labelId`

## Key Patterns
- **PrivacyProvider** (`src/components/privacy-provider.tsx`) — shared hide-amounts state across all app pages, persisted in DB via `/api/preferences`
- **UserProvider** (`src/components/user-provider.tsx`) — reactive user info (name, email, currency, receiptScanEnabled, timezoneOffset) shared across components
- **ScanProvider** (`src/components/scan-provider.tsx`) — receipt capture state (captured images, scan results, multi-scan queue)
- **BillReminderProvider** (`src/components/bills/bill-reminder-provider.tsx`) — manages upcoming/overdue bill banners across the app
- **App layout** (`src/app/(app)/layout.tsx`) wraps pages with `Providers > PrivacyProvider > AppShell`
- **ActionFab** (`src/components/ui/action-fab.tsx`) — the floating create button on dashboard, transactions, bills, categories and labels, at *every* width. It was `sm:hidden`, which left desktop with only the page-header button: that scrolls away, so adding a transaction from the bottom of a long list meant scrolling back to the top. Two breakpoints are in play and they deliberately differ. **Visibility** switches at `sm`, mirroring the header button's own gate: below it the FAB rests in place and ducks out of the way while the page scrolls, above it the header button is on screen at the top, so the FAB stays hidden until the page has scrolled past `REVEAL_SCROLL_PX`. **Geometry** switches at `lg`, which is where `MobileTabBar` (`lg:hidden`) stops occupying the bottom of the viewport — a tablet reveals on scroll but still has a nav to clear. Visibility is React state, since "scrolled past" is not expressible as a media query; the offset is CSS custom properties the `lg:` variant switches between, the same way both bottom banners do it. `isDesktop` starts `null` and the button renders hidden *without a transition* until the mount effect resolves it, so the server and first client render agree and desktop never flashes a button at the top of the page only to fade it back out. `disabled` tracks the hidden state and `pointer-events-none` goes on the wrapper, because an invisible button still wins the hit test and would swallow clicks meant for the page beneath it. An optional `items` opens the same `DropdownMenu` as the header dropdown (`placement="top"`, since a bottom-anchored trigger has no room below it) and is **ignored below `sm`**, where the tab bar already carries scan; dashboard and transactions pass the one array to both so the two menus cannot drift. `<main>` reserves matching bottom clearance at both breakpoints (`getFabContentClearance`/`…Desktop` in `bottom-overlay-clearance.ts`), or the last row of a list sits under the button
- **ConfirmModal** (`src/components/ui/confirm-modal.tsx`) — reusable delete/deactivate confirmation dialog
- **Modal** (`src/components/ui/modal.tsx`) — uses `visualViewport` API for keyboard-aware positioning on iOS Safari
- **TanStack React Query** — all data fetching uses React Query; `queryKeys` object in each query hook scopes cache invalidation; `query-client.ts` exports a factory (needed for server/client separation)
- **Timezone offsets** — all date-range queries accept a `timezoneOffset` (minutes, `getTimezoneOffset()` convention so UTC+8 is -480) for correct day/month boundaries; offset stored in `users.timezone_offset` and provided by `UserProvider`. One formula app-wide, `Date.UTC(y, m, d) + tzOffset * 60000` (see `/api/dashboard`, `analytics-period.ts`, and `parseMonth` in `budget-queries.ts`). In `budget-queries.ts` the param is optional and defaults to UTC, so **a caller that forgets it gets silently wrong months rather than a type error** — pass it explicitly from anything that has a user
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
