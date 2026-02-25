# Budget Tracker

A personal budget tracking app built with Next.js, TypeScript, and PostgreSQL. Track income and expenses, manage categories, and visualize your spending with an interactive dashboard.

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma)
![TanStack Query](https://img.shields.io/badge/TanStack_Query-5-FF4154?logo=reactquery)

## Features

- **Landing Page** — Redesigned marketing homepage with 3D dashboard mockup preview, AI receipt scanning showcase with phone mockup, 8-feature grid, and scroll-triggered animations
- **Authentication** — Register and login with email/password (NextAuth.js with JWT sessions); role-based access control (ADMIN, FREE, PAID)
- **Dashboard** — Summary cards (balance, expenses, income), monthly trend bar chart, spending by category donut chart, balance trend area chart, recent transactions
- **Running Balance** — Cumulative all-time balance that carries over across months, not just monthly snapshots
- **Balance Trend** — 30-day area chart showing daily running balance with percentage change indicator
- **Transactions** — Full CRUD with search, type filtering (income/expense), month navigation, infinite scroll (with pagination toggle), hero amount input with dynamic type coloring, date quick-picks (Today/Yesterday/Custom), slide-in category picker, and advanced filters (category, amount range, sort)
- **Quick Category Tiles** — Personalized top-4 quick-access categories per type (expense/income) with customizable order; shown in the transaction form and editable from the Categories page
- **Categories** — 15 pre-seeded defaults (10 expense, 5 income) + create/edit/delete custom categories with color swatches, icon grid, and live preview
- **User Roles** — Three-tier role system (ADMIN, FREE, PAID); new users default to FREE; admin can manually promote users to PAID via an admin panel; receipt scanning gated to PAID/ADMIN users
- **Admin Panel** — Admin-only user management page (`/admin`) with user list, role badges, transaction counts, and one-click FREE/PAID role toggle; scan settings page with per-role configuration for receipt scanning, upload limits, and monthly scan limits; protected by middleware and API-level guards
- **Receipt Scanning** — Snap a photo or upload multiple receipts and AI (Google Gemini) extracts the amount, date, category, and merchant to pre-fill transactions; batch scanning with live review modal and parallel processing; smart category matching with merchant-aware rules; non-receipt image detection; images compressed client-side before upload; HEIC/HEIF support; desktop scan dropdown on Add Transaction buttons; available to PAID/ADMIN users
- **Monthly Scan Limits** — Configurable per-role monthly scan caps (0 = unlimited); usage badge on mobile scan button; remaining scans info in scan sheet; desktop sidebar warnings when running low or exhausted; ADMIN always unlimited
- **TanStack Query Caching** — Client-side data caching for transactions, dashboard stats, categories, and quick-access preferences; instant re-renders on modal re-open (no loading shimmer after first fetch); in-place cache updates on create/edit/delete mutations
- **Profile Settings** — Edit name, email, and preferred currency; change password with current-password verification; role badge displayed in header; feature toggles gated by role; sidebar updates instantly via shared context
- **Dynamic Currency** — Currency selected in profile settings reflects across all pages — dashboard, transactions, charts, and forms
- **Privacy Mode** — One-tap toggle to hide all financial amounts across the app, persisted per-user in the database
- **Responsive** — Sidebar navigation on desktop, bottom navigation on mobile; labeled floating action buttons on mobile; modal bottom sheets with drag-to-dismiss on mobile, centered cards on desktop; keyboard-aware modals on iOS Safari
- **Dynamic Favicon** — Auto-generated favicon matching the app logo
- **Design** — Warm paper-ledger aesthetic with Young Serif + Outfit fonts, Plus Jakarta Sans for currency amounts, amber accents, and Framer Motion animations

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL + Prisma ORM |
| Auth | NextAuth.js v4 (Credentials) |
| Forms | React Hook Form + Zod |
| Data Caching | TanStack Query |
| Charts | Recharts |
| OCR / AI | Google Gemini |
| Icons | Lucide React |
| Animation | Framer Motion |

## Prerequisites

- **Node.js** 20+
- **pnpm** (package manager)
- **PostgreSQL** running locally or remotely

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/chrisgen19/budget-tracker-2026.git
cd budget-tracker-2026
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set up environment variables

Copy the example env file and update with your database credentials:

```bash
cp .env.example .env
```

```env
DATABASE_URL="postgres://myuser:mypassword@localhost:5432/budgettracker-nextjs"
NEXTAUTH_SECRET="change-this-to-a-random-secret-in-production"
NEXTAUTH_URL="http://localhost:3000"

# Google Gemini (optional — enables receipt scanning)
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-2.5-flash"
```

> **Note:** Generate a secure `NEXTAUTH_SECRET` for production with `openssl rand -base64 32`
>
> **Receipt Scanning:** The `GEMINI_API_KEY` is only required if you enable the receipt scanning feature. Get one from [Google AI Studio](https://aistudio.google.com/apikey).

### 4. Create the database and run migrations

```bash
createdb budgettracker-nextjs   # or create via psql/pgAdmin
pnpm db:migrate
```

### 5. Seed default categories

```bash
pnpm db:seed
```

### 6. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), register an account, and start tracking.

## Available Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start development server (Turbopack) |
| `pnpm build` | Create production build |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm type-check` | Run TypeScript type checker |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:seed` | Seed default categories + set admin role |
| `pnpm db:studio` | Open Prisma Studio (database GUI) |

## Git Hooks

This project uses **husky** + **lint-staged** to enforce code quality before code reaches the repository:

| Hook | What runs | Purpose |
|---|---|---|
| Pre-commit | `lint-staged` (ESLint on staged `.ts`/`.tsx` files) | Catch lint issues immediately |
| Pre-push | `pnpm type-check` (full codebase) | Block push on type errors |

Hooks are installed automatically via the `prepare` script when you run `pnpm install`.

## Project Structure

```
src/
├── app/
│   ├── page.tsx             # Root — landing page (guest) or redirect (auth)
│   ├── (auth)/              # Login & Register pages
│   │   ├── login/
│   │   └── register/
│   ├── (app)/               # Protected pages (requires auth)
│   │   ├── dashboard/       # Dashboard with charts & summaries
│   │   ├── transactions/    # Transaction list with CRUD
│   │   ├── categories/      # Category management
│   │   ├── profile/         # Profile settings (name, email, currency, password)
│   │   └── admin/           # Admin panel (user management, scan settings)
│   └── api/                 # REST API routes
│       ├── auth/            # NextAuth handler
│       ├── register/        # User registration
│       ├── admin/           # Admin: users, roles, scan settings
│       ├── transactions/    # Transaction CRUD
│       ├── categories/      # Category CRUD
│       ├── dashboard/       # Dashboard stats + balance trend
│       ├── preferences/     # User preferences (privacy, quick categories, features)
│       ├── profile/         # Profile & password update
│       └── receipts/scan/   # Receipt OCR via Gemini AI
├── components/
│   ├── ui/                  # Shared UI (Modal, EmptyState, IconMap)
│   ├── dashboard/           # Chart components (Trend, Spending, BalanceTrend)
│   ├── transactions/        # Transaction form
│   ├── categories/          # Category form + quick category picker
│   ├── landing-page.tsx     # Marketing homepage for guests
│   ├── scan-receipt-sheet.tsx # Receipt capture modal (camera/upload)
│   ├── multi-scan-review.tsx # Batch scan review modal
│   ├── privacy-provider.tsx # Hide-amounts context (persisted in DB)
│   └── user-provider.tsx    # Reactive user info context (name, email, currency, role)
├── hooks/                   # TanStack Query hooks (use-transactions, use-categories)
├── lib/                     # Prisma client, auth, Gemini client, query client, utils, validations
└── types/                   # TypeScript type definitions

prisma/
├── schema.prisma            # Database schema
├── seed.ts                  # Default category seeder
└── migrations/              # Migration history
```

## Database Schema

```
User ──< Transaction >── Category
 │                          │
 ├────────< Category (custom, per-user)
 └────────< ScanLog

AppSettings (per role: FREE, PAID)
```

- **User** — id, name, email, password, role (ADMIN/FREE/PAID), currency, hide_amounts, quickExpenseCategories, quickIncomeCategories, receiptScanEnabled, transactionLayout
- **Category** — id, name, type (INCOME/EXPENSE), icon, color, isDefault, userId (null for defaults)
- **Transaction** — id, amount, description, type, date, categoryId, userId
- **AppSettings** — id, role (unique), receiptScanEnabled, maxUploadFiles, monthlyScanLimit
- **ScanLog** — id, userId, createdAt (tracks scan usage for monthly limits)

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full development history and feature log.

## License

MIT
