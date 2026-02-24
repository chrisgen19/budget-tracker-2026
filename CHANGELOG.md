# Changelog

All notable development history for the Budget Tracker app.

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
