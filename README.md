# Budget Tracker

A personal budget tracking app built with Next.js, TypeScript, and PostgreSQL. Track income and expenses, manage categories, and visualize your spending with an interactive dashboard.

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma)

## Features

- **Landing Page** — Marketing homepage for non-authenticated users with dashboard preview, feature highlights, and sign-up CTAs
- **Authentication** — Register and login with email/password (NextAuth.js with JWT sessions)
- **Dashboard** — Summary cards (income, expenses, running balance), monthly trend bar chart, spending by category donut chart, balance trend area chart, recent transactions
- **Running Balance** — Cumulative all-time balance that carries over across months, not just monthly snapshots
- **Balance Trend** — 30-day area chart showing daily running balance with percentage change indicator
- **Transactions** — Full CRUD with search, type filtering (income/expense), month navigation, pagination, auto-comma amount formatting, and datetime picker
- **Categories** — 15 pre-seeded defaults (10 expense, 5 income) + create/edit/delete custom categories with color and icon pickers
- **Privacy Mode** — One-tap toggle to hide all financial amounts across the app, persisted per-user in the database
- **Responsive** — Sidebar navigation on desktop, bottom navigation on mobile; horizontal scroll summary cards with snap points on mobile
- **Design** — Warm paper-ledger aesthetic with Young Serif + Outfit fonts, amber accents, and Framer Motion animations

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL + Prisma ORM |
| Auth | NextAuth.js v4 (Credentials) |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
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
```

> **Note:** Generate a secure `NEXTAUTH_SECRET` for production with `openssl rand -base64 32`

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
| `pnpm db:seed` | Seed default categories |
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
│   │   └── categories/      # Category management
│   └── api/                 # REST API routes
│       ├── auth/            # NextAuth handler
│       ├── register/        # User registration
│       ├── transactions/    # Transaction CRUD
│       ├── categories/      # Category CRUD
│       ├── dashboard/       # Dashboard stats + balance trend
│       └── preferences/     # User preferences (privacy toggle)
├── components/
│   ├── ui/                  # Shared UI (Modal, EmptyState, IconMap)
│   ├── dashboard/           # Chart components (Trend, Spending, BalanceTrend)
│   ├── transactions/        # Transaction form
│   ├── categories/          # Category form
│   ├── landing-page.tsx     # Marketing homepage for guests
│   └── privacy-provider.tsx # Hide-amounts context (persisted in DB)
├── lib/                     # Prisma client, auth, utils, validations
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
 └────────< Category (custom, per-user)
```

- **User** — id, name, email, password, hide_amounts (privacy toggle preference)
- **Category** — id, name, type (INCOME/EXPENSE), icon, color, isDefault, userId (null for defaults)
- **Transaction** — id, amount, description, type, date, categoryId, userId

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full development history and feature log.

## License

MIT
