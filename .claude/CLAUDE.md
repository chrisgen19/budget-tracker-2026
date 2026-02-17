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
- **Charts:** Recharts
- **Icons:** Lucide React
- **Animation:** Framer Motion

## Project Structure
```
src/
├── app/
│   ├── (auth)/         # Login + Register pages
│   ├── (app)/          # Protected: Dashboard, Transactions, Categories
│   └── api/            # REST API routes
├── components/
│   ├── ui/             # Shared UI (Modal, EmptyState, IconMap)
│   ├── dashboard/      # Chart components
│   ├── transactions/   # Transaction form
│   └── categories/     # Category form
├── lib/                # Prisma client, auth config, utils, validations
└── types/              # TypeScript type definitions
```

## Commands
- `pnpm dev` — Start dev server
- `pnpm build` — Production build
- `pnpm lint` — Run ESLint
- `pnpm type-check` — Run TypeScript type checker
- `pnpm db:migrate` — Run Prisma migrations
- `pnpm db:seed` — Seed default categories
- `pnpm db:studio` — Open Prisma Studio

## Database
- `DATABASE_URL` in `.env` points to local PostgreSQL
- Default categories are seeded (15 total: 10 expense, 5 income)
- Users can create custom categories on top of defaults

## Design
- "Light & Warm" aesthetic with cream/paper-like backgrounds
- Fonts: Young Serif (headings) + Outfit (body)
- Color palette: warm browns, amber accents, green for income, red for expenses
