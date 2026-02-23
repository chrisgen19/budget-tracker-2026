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
- **OCR / AI:** Google Gemini (receipt scanning)
- **Icons:** Lucide React
- **Animation:** Framer Motion

## Project Structure
```
src/
├── app/
│   ├── (auth)/         # Login + Register pages
│   ├── (app)/          # Protected: Dashboard, Transactions, Categories, Profile
│   └── api/            # REST API routes (incl. /receipts/scan)
├── components/
│   ├── ui/             # Shared UI (Modal, EmptyState, IconMap)
│   ├── dashboard/      # Chart components
│   ├── transactions/   # Transaction form
│   ├── categories/     # Category form
│   └── scan-receipt-sheet.tsx  # Receipt capture modal
├── lib/                # Prisma client, auth config, Gemini client, utils, validations
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

## Key Patterns
- **PrivacyProvider** context in `src/components/privacy-provider.tsx` — shared hide-amounts state across all app pages, persisted in DB via `/api/preferences`
- **UserProvider** context in `src/components/user-provider.tsx` — reactive user info (name, email, currency, receiptScanEnabled) shared across components
- **App layout** (`src/app/(app)/layout.tsx`) wraps pages with `Providers > PrivacyProvider > AppShell`
- **Mobile FAB** on dashboard for quick-add transaction (hidden on desktop, which uses inline button)
- **Receipt scanning** is opt-in per user — toggled in Profile Settings > Features, uses Gemini AI for OCR
- **Modal** component (`src/components/ui/modal.tsx`) uses `visualViewport` API for keyboard-aware positioning on iOS Safari

## Design
- "Light & Warm" aesthetic with cream/paper-like backgrounds
- Fonts: Young Serif (headings) + Outfit (body)
- Color palette: warm browns, amber accents, green for income, red for expenses

## Changelog
See [CHANGELOG.md](../../CHANGELOG.md) for full development history and feature log.
