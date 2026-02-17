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
