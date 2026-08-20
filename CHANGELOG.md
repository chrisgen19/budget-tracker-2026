# Changelog

All notable development history for the Budget Tracker app.

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
- Scan orchestration moved out of `AppShell` (760 lines) into `src/hooks/use-multi-scan.ts`: capture, the review queue, itemisation, retry, and the atomic save. `AppShell` is down to 454 lines

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
