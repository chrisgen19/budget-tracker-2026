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
- **Authentication** — Register and login with email/password (NextAuth.js with JWT sessions); email verification via Resend; password reset flow with secure token links; role-based access control (ADMIN, FREE, PAID)
- **Dashboard** — Summary cards (balance, expenses, income), monthly trend bar chart, spending by category donut chart, balance trend area chart, recent transactions
- **Running Balance** — Cumulative all-time balance that carries over across months, not just monthly snapshots
- **Balance Trend** — 30-day area chart showing daily running balance with percentage change indicator
- **Transactions** — Full CRUD with search, type filtering (income/expense), month navigation, infinite scroll (with pagination toggle), hero amount input with dynamic type coloring, date quick-picks (Today/Yesterday/Custom), slide-in category picker, advanced filters (category, amount range, sort), and auto-scroll with highlight animation on newly created or updated transactions
- **Quick Category Tiles** — Personalized top-4 quick-access categories per type (expense/income) with customizable order; shown in the transaction form and editable from the Categories page
- **Categories** — 15 pre-seeded defaults (10 expense, 5 income) + create/edit/delete custom categories with color swatches, icon grid, and live preview
- **User Roles** — Three-tier role system (ADMIN, FREE, PAID); new users default to FREE; admin can manually promote users to PAID via an admin panel; receipt scanning gated to PAID/ADMIN users
- **Admin Panel** — Admin-only user management page (`/admin`) with user list, role badges, transaction counts, and one-click FREE/PAID role toggle; scan settings page with per-role configuration for receipt scanning, upload limits, and monthly scan limits; protected by middleware and API-level guards
- **Receipt Scanning** — Snap a photo or upload multiple receipts and AI (Google Gemini) extracts the amount, date, category, and merchant to pre-fill transactions; batch scanning with live review modal and parallel processing; smart category matching with merchant-aware rules; non-receipt image detection; images compressed client-side before upload; HEIC/HEIF support; desktop scan dropdown on Add Transaction buttons; available to PAID/ADMIN users
- **Receipt Itemization** — One-tap "Itemize" button splits a scanned receipt into multiple transactions grouped by spending category (e.g., Food & Dining, Personal Care, Household); each itemized transaction stores its individual line items and displays them in a collapsible "Receipt Breakdown" section inside the edit modal showing every product name and price from the receipt
- **Monthly Scan Limits** — Configurable per-role monthly scan caps (0 = unlimited); usage badge on mobile scan button; remaining scans info in scan sheet; desktop sidebar warnings when running low or exhausted; ADMIN always unlimited
- **TanStack Query Caching** — Client-side data caching for transactions, dashboard stats, categories, and quick-access preferences; instant re-renders on modal re-open (no loading shimmer after first fetch); in-place cache updates on create/edit/delete mutations
- **Profile Settings** — Edit name, email, and preferred currency; change password with current-password verification; role badge displayed in header; feature toggles gated by role; sidebar updates instantly via shared context
- **Dynamic Currency** — Currency selected in profile settings reflects across all pages — dashboard, transactions, charts, and forms
- **Privacy Mode** — One-tap toggle to hide all financial amounts across the app, persisted per-user in the database
- **Responsive** — Sidebar navigation on desktop, bottom navigation on mobile; labeled floating action buttons on mobile; modal bottom sheets with drag-to-dismiss on mobile, centered cards on desktop; keyboard-aware modals on iOS Safari
- **Dynamic Favicon** — Auto-generated favicon matching the app logo
- **Transaction Labels** — User-created color-coded labels with optional type restriction (expense/income/both); label picker in transaction form; label pills on transaction lists (dashboard + transactions page); quick-remove from list view
- **Label Schedules (Auto-Tagging)** — Time-of-day + day-of-week schedules per label for automatic tagging (e.g. "Work" on weekdays 9am–5pm); client-side reactive matching via `useScheduledLabel` hook; server-side auto-labeling on create/batch/bill-pay; retroactive apply to existing transactions; auto-labeling only on new transactions (edits preserve user's label choices)
- **Scheduled Bills & Reminders** — Recurring bill management with configurable frequency (weekly, biweekly, monthly, quarterly, yearly); mobile toast reminders for upcoming and overdue bills; one-tap pay that auto-creates the expense transaction; snooze (1d/3d/1w) and skip actions; pay-all for batch payments; bill history with links to past payments
- **Progressive Web App** — Installable PWA with offline support via Serwist service worker; install prompt banner (Android + iOS Safari guide); standalone mode with safe-area handling; smart caching for API responses and static assets
- **Timezone-Aware Dates** — All date queries respect the user's local timezone offset for accurate day boundaries and month grouping
- **MCP Server** — Local Model Context Protocol server for querying budget data from Claude Desktop; 8 read-only tools (spending by category, top expenses, monthly summary, spending trends, search transactions, budget overview, upcoming bills, category list); shared query library reusable for future in-app AI chat
- **Analytics** — Dedicated reporting page with income vs expenses bar chart, cash flow area chart (net + cumulative), category breakdown donut chart, label breakdown horizontal bars, summary cards, and flexible time range controls (weekly/monthly/yearly/custom)
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
| Email | Resend |
| PWA | Serwist (Service Worker) |
| MCP Server | Model Context Protocol SDK |
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
NEXTAUTH_URL="http://localhost:3111"

# Google Gemini (optional — enables receipt scanning)
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-2.5-flash"

# Gemini tuning (all optional — these are the defaults used when unset)
GEMINI_FALLBACK_MODEL="gemini-2.5-flash"   # "" disables fallback
GEMINI_THINKING_LEVEL="medium"             # used by Gemini 3+ models
GEMINI_THINKING_BUDGET="-1"                # used by Gemini 2.x models
GEMINI_TIMEOUT_MS="60000"                  # per-attempt timeout; 0 disables
```

> **Note:** Generate a secure `NEXTAUTH_SECRET` for production with `openssl rand -base64 32`
>
> **Receipt Scanning:** The `GEMINI_API_KEY` is only required if you enable the receipt scanning feature. Get one from [Google AI Studio](https://aistudio.google.com/apikey).

#### Gemini tuning options

All four are optional — when unset, the defaults shown above apply. The right thinking knob is picked automatically from the model generation. Defaults favor **extraction quality** (thinking enabled); switch to **speed mode** (`minimal` / `0`) for ~3x faster scans at the cost of reasoning on tricky receipts.

| Variable | Possible values | Notes |
|---|---|---|
| `GEMINI_FALLBACK_MODEL` | any Gemini model id, or `""` | Tried once when `GEMINI_MODEL` stays overloaded (503/504) after retries. `""` disables fallback. Fast alternative: `gemini-2.5-flash-lite` |
| `GEMINI_THINKING_LEVEL` | `minimal` \| `low` \| `medium` \| `high` | **Gemini 3+ models only** (e.g. `gemini-3.5-flash`). `medium` (default) = model's native reasoning; `minimal` = speed mode |
| `GEMINI_THINKING_BUDGET` | `-1` \| `0` \| `128`–`24576` | **Gemini 2.x models only** (e.g. `gemini-2.5-flash`). `-1` (default) = dynamic thinking, `0` = speed mode, number = fixed token budget. Valid range varies per model |
| `GEMINI_TIMEOUT_MS` | milliseconds, or `0` | Aborts hung attempts so retry/fallback kicks in sooner; timed-out attempts are retried like 503s. `0` disables. Default `60000` suits thinking-enabled scans; `30000` suits speed mode |

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

Open [http://localhost:3111](http://localhost:3111), register an account, and start tracking.

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

## MCP Server (Claude Desktop Integration)

The project includes a local [Model Context Protocol](https://modelcontextprotocol.io/) server that lets you query your budget data directly from Claude Desktop using natural language — e.g., "what's my biggest spending category?" or "how much did I spend on food this month?"

### Architecture

```
Claude Desktop → (stdio) → MCP Server (local script) → Prisma → PostgreSQL
```

The MCP server is a standalone TypeScript script that runs locally via `tsx`. It is **not** a hosted server — Claude Desktop starts and stops it automatically.

It has its own `package.json`, lockfile, and `.npmrc`, but it is standalone only in its
dependency tree: it imports the shared query layer from `src/lib/budget-queries.ts` and
links `@prisma/client` to the app's generated client rather than generating a second one.
So the app's dependencies must be installed first.

### Setup

#### 1. Install app dependencies first

```bash
pnpm install
```

This generates the Prisma client (via `postinstall`) that the MCP server links to. Skipping
it leaves `@prisma/client` unresolved in step 2.

#### 2. Install MCP server dependencies

```bash
cd mcp-server && pnpm install && cd ..
```

No separate `prisma generate` is needed here. The package links to the client generated in
step 1, which keeps the two from drifting to different schema versions.

To verify the server compiles against the current query layer:

```bash
cd mcp-server && pnpm type-check && cd ..
```

CI runs this on every PR.

#### 3. Find your user ID

```bash
pnpm db:studio
```

Open the `User` table in Prisma Studio and copy your user's `id` value.

#### 4. Configure Claude Desktop

Edit your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the following (replace the placeholder values):

```json
{
  "mcpServers": {
    "budgettracker": {
      "command": "/absolute/path/to/budgettracker/mcp-server/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/budgettracker/mcp-server/src/index.ts"],
      "env": {
        "DATABASE_URL": "postgres://myuser:mypassword@localhost:5432/budgettracker-nextjs",
        "BUDGET_USER_ID": "your-user-id-here"
      }
    }
  }
}
```

`tsx` is a declared devDependency of the MCP package, so pointing at the local binary runs
a pinned version. `npx tsx` also works, but resolves the version at launch and prints npm
warnings about this package's `.npmrc` settings.

#### 5. Restart Claude Desktop

Claude Desktop will automatically start the MCP server when you open a conversation. No manual startup needed.

### Available MCP Tools

| Tool | Description |
|---|---|
| `get_spending_by_category` | Spending grouped by category for a given month, with percentages |
| `get_top_expenses` | Largest individual expense transactions, optionally filtered by month |
| `get_monthly_summary` | Income, expenses, and net per month for the last N months |
| `get_spending_trends` | Compare spending between two months — shows which categories increased or decreased |
| `search_transactions` | Search and filter transactions by description, category, amount range, type, and month |
| `get_budget_overview` | High-level monthly summary: income, expenses, net, running balance, transaction count |
| `get_upcoming_bills` | Scheduled transactions (bills) due within N days, including overdue |
| `get_category_list` | All categories (default + custom) — useful for finding category IDs |

### Testing with MCP Inspector

To verify tools work correctly before using in Claude Desktop:

```bash
BUDGET_USER_ID=your-user-id DATABASE_URL="your-database-url" npx @modelcontextprotocol/inspector mcp-server/node_modules/.bin/tsx mcp-server/src/index.ts
```

This opens a web UI at `http://localhost:6274` where you can call each tool and inspect the results.

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
│   │   ├── analytics/       # Analytics & reporting page
│   │   ├── transactions/    # Transaction list with CRUD
│   │   ├── categories/      # Category management
│   │   ├── bills/           # Scheduled bills & reminders
│   │   ├── profile/         # Profile settings (name, email, currency, password)
│   │   └── admin/           # Admin panel (user management, scan settings)
│   └── api/                 # REST API routes
│       ├── auth/            # NextAuth handler
│       ├── register/        # User registration
│       ├── admin/           # Admin: users, roles, scan settings
│       ├── transactions/    # Transaction CRUD
│       ├── categories/      # Category CRUD
│       ├── analytics/       # Analytics API (time range + breakdown)
│       ├── dashboard/       # Dashboard stats + balance trend
│       ├── bills/           # Scheduled bill CRUD + upcoming bills
│       ├── preferences/     # User preferences (privacy, quick categories, features)
│       ├── profile/         # Profile & password update
│       ├── email/           # Email verification + password reset (Resend)
│       └── receipts/        # Receipt OCR + itemized breakdown via Gemini AI
├── components/
│   ├── ui/                  # Shared UI (Modal, ConfirmModal, MobileFab, EmptyState, IconMap)
│   ├── analytics/           # Analytics charts (IncomeExpenses, CashFlow, CategoryBreakdown, LabelBreakdown)
│   ├── dashboard/           # Chart components (Trend, Spending, BalanceTrend)
│   ├── transactions/        # Transaction form + receipt breakdown viewer
│   ├── categories/          # Category form + quick category picker
│   ├── bills/               # Bill form + bill reminder provider
│   ├── pwa/                 # Install prompt banner + banner context
│   ├── landing-page.tsx     # Marketing homepage for guests
│   ├── scan-receipt-sheet.tsx # Receipt capture modal (camera/upload)
│   ├── multi-scan-review.tsx # Batch scan review modal
│   ├── privacy-provider.tsx # Hide-amounts context (persisted in DB)
│   └── user-provider.tsx    # Reactive user info context (name, email, currency, role)
├── hooks/                   # TanStack Query hooks (use-transactions, use-categories)
├── lib/                     # Prisma client, auth, Gemini client, query client, utils, validations
│   ├── budget-queries.ts    # Shared query functions (used by MCP server + future AI chat)
│   └── budget-query-types.ts # TypeScript types for query params and return values
└── types/                   # TypeScript type definitions

mcp-server/                  # MCP server for Claude Desktop integration
├── package.json             # Standalone dependencies (@modelcontextprotocol/sdk)
├── tsconfig.json            # Standalone TypeScript config
└── src/
    └── index.ts             # Entry point — registers 8 read-only tools

prisma/
├── schema.prisma            # Database schema
├── seed.ts                  # Default category seeder
└── migrations/              # Migration history
```

## Database Schema

```
User ──< Transaction >── Category
 │           │              │
 │           └──< TransactionLabel >── Label ──< LabelSchedule
 │                                      │
 ├────────< Label (per-user)            │
 ├────────< Category (custom, per-user)
 ├────────< Bill >── Category
 ├────────< ScanLog
 └────────< VerificationToken

AppSettings (per role: FREE, PAID)
```

- **User** — id, name, email, emailVerified, password, role (ADMIN/FREE/PAID), currency, timezoneOffset, hide_amounts, quickExpenseCategories, quickIncomeCategories, receiptScanEnabled, transactionLayout
- **Category** — id, name, type (INCOME/EXPENSE), icon, color, isDefault, userId (null for defaults)
- **Transaction** — id, amount, description, type, date, categoryId, userId, billId, receiptGroupId (links itemized siblings), receiptBreakdown (JSON — individual line items)
- **Bill** — id, amount, description, frequency, nextDueDate, isActive, categoryId, userId (recurring scheduled transactions)
- **Label** — id, name, color, applicableTo (EXPENSE/INCOME/BOTH), userId, createdAt
- **LabelSchedule** — id, labelId, days (int[]), startTime, endTime (HH:mm strings)
- **TransactionLabel** — id, transactionId, labelId (join table)
- **AppSettings** — id, role (unique), receiptScanEnabled, maxUploadFiles, monthlyScanLimit
- **ScanLog** — id, userId, createdAt (tracks scan usage for monthly limits)
- **VerificationToken** — id, token, type (EMAIL_VERIFY/PASSWORD_RESET), userId, expiresAt

## Analytics Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Income & Expenses Report, Category Breakdown, Label Breakdown, Cash Flow, Time Range Controls | Done |
| 2 | Period Comparison — compare two time ranges side by side | Planned |
| 3 | Records & Statistics — biggest expense, avg daily spend, most used category, streaks | Planned |
| 4 | Financial Health Score — savings rate, expense ratio, trend indicators | Planned |

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full development history and feature log.

## License

MIT
