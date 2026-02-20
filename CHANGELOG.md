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
