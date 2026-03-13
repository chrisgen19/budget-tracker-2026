# Code Review Guide — Budget Tracker

This document provides a structured checklist for reviewing pull requests and code changes in the Budget Tracker project.

---

## Table of Contents

- [Quick Start for Reviewers](#quick-start-for-reviewers)
- [Pre-Review Checklist](#pre-review-checklist)
- [Security Review](#security-review)
- [API Route Review](#api-route-review)
- [Frontend / Component Review](#frontend--component-review)
- [Database & Prisma Review](#database--prisma-review)
- [Performance Review](#performance-review)
- [PWA & Service Worker Review](#pwa--service-worker-review)
- [Accessibility Review](#accessibility-review)
- [Code Style & Conventions](#code-style--conventions)
- [Common Pitfalls](#common-pitfalls)
- [File Reference](#file-reference)

---

## Quick Start for Reviewers

1. Pull the branch locally and run `pnpm install`
2. Run `pnpm lint && pnpm type-check` — both must pass with zero warnings
3. Run `pnpm dev` and manually test the affected feature
4. Walk through this checklist based on which areas the PR touches

---

## Pre-Review Checklist

Every PR should pass these before merge:

- [ ] `pnpm lint` passes with `--max-warnings 0`
- [ ] `pnpm type-check` passes with no errors
- [ ] No `console.log` statements in committed code
- [ ] No secrets, API keys, or `.env` values in the diff
- [ ] No unrelated file changes (keep PRs focused)
- [ ] Commit messages follow conventional format: `type(scope): description`
- [ ] Loading, error, and empty states handled for any new/changed UI
- [ ] CHANGELOG.md updated if behavior, routes, or setup changed

---

## Security Review

### Authentication & Authorization

- [ ] All new API routes call `getAuthUserId()`, `getAuthUser()`, or `requireAdmin()`
- [ ] Admin-only routes use `requireAdmin()` — not just role checks in the UI
- [ ] Ownership checks present: transactions, categories, and bills verify `userId` matches the authenticated user
- [ ] No sensitive data returned in API responses that shouldn't be (passwords, tokens, other users' data)

### Input Validation

- [ ] All user input validated with Zod schemas from `src/lib/validations.ts`
- [ ] New API fields have corresponding Zod schema updates
- [ ] File uploads enforce MIME type (`image/*`) and size limits (4MB max)
- [ ] No raw user input interpolated into queries — Prisma parameterizes by default, but verify no `$queryRaw` with string concatenation

### Password & Token Handling

- [ ] Passwords hashed with `bcryptjs` (12 salt rounds) — never stored or logged in plaintext
- [ ] Verification tokens expire (24h for email, 1h for password reset)
- [ ] Token cleanup happens on validation (expired tokens removed)
- [ ] Password changes require current password verification

### Rate Limiting

- [ ] Receipt scan endpoints enforce monthly scan limits via `ScanLog`
- [ ] `hasRecentToken()` prevents token spam (email verification, password reset)
- [ ] Role-based limits respected: FREE < PAID < ADMIN

---

## API Route Review

### Structure & Patterns

- [ ] Route follows existing patterns in `src/app/api/`
- [ ] Auth check is the **first** operation in the handler
- [ ] Zod validation runs **before** any database call
- [ ] Returns appropriate HTTP status codes (200, 201, 400, 401, 403, 404, 500)
- [ ] Error responses use consistent JSON shape: `{ error: string }`
- [ ] Try/catch wraps the handler body with a generic 500 fallback

### Data Integrity

- [ ] Create/update operations validate foreign keys exist (e.g., `categoryId` belongs to user)
- [ ] Delete operations check for dependent records (e.g., can't delete category with transactions)
- [ ] Batch operations are wrapped in transactions where atomicity matters
- [ ] Timezone offset applied to date-range queries (via `timezoneOffset` parameter)

### Existing Routes Reference

| Area | Routes |
|------|--------|
| Auth | `/api/register`, `/api/auth/[...nextauth]` |
| Email | `/api/email/verify`, `/api/email/forgot-password`, `/api/email/reset-password`, `/api/resend-verification` |
| Transactions | `/api/transactions` (GET/POST), `/api/transactions/[id]` (PUT/DELETE), `/api/transactions/batch` (POST) |
| Categories | `/api/categories` (GET/POST), `/api/categories/[id]` (PUT/DELETE) |
| Bills | `/api/bills` (GET/POST), `/api/bills/[id]` (PUT/DELETE), `/api/bills/upcoming`, `/api/bills/pending`, `/api/bills/[id]/action`, `/api/bills/[id]/history` |
| Dashboard | `/api/dashboard` (GET) |
| Receipts | `/api/receipts/scan` (POST), `/api/receipts/breakdown` (POST) |
| Profile | `/api/profile` (GET/PATCH), `/api/profile/password` (POST), `/api/preferences` (GET/PATCH) |
| Admin | `/api/admin/users` (GET), `/api/admin/users/[id]` (PUT), `/api/admin/settings` (GET/PUT) |

---

## Frontend / Component Review

### Component Quality

- [ ] Components stay under ~150 lines; extract sub-components or hooks if larger
- [ ] Functions stay under ~50 lines
- [ ] No inline styles — use Tailwind utility classes
- [ ] No `@apply` unless truly necessary
- [ ] Named exports used (except Next.js `page.tsx` / `layout.tsx` defaults)

### State Management

- [ ] Local state (`useState`) for component-scoped UI state
- [ ] Context providers for cross-component shared state (privacy, user, scan, bills)
- [ ] TanStack Query for all server data — no manual `useEffect` + `fetch` patterns
- [ ] Query keys follow existing conventions in `src/hooks/use-*.ts`
- [ ] Mutations invalidate the correct query keys after success

### Mobile & Responsive

- [ ] Layout works on mobile (375px+) and desktop
- [ ] Touch targets are at least 44x44px on mobile
- [ ] MobileFab positioning accounts for install banner height (via `InstallBannerContext`)
- [ ] Modals use `visualViewport` API for iOS Safari keyboard awareness
- [ ] Bottom navigation doesn't overlap with content or FAB

### Context Providers

| Provider | Purpose | Location |
|----------|---------|----------|
| `PrivacyProvider` | Hide/show amounts toggle | `src/components/privacy-provider.tsx` |
| `UserProvider` | User info (currency, timezone, role) | `src/components/user-provider.tsx` |
| `ScanProvider` | Receipt scan queue state | `src/components/scan-provider.tsx` |
| `BillReminderProvider` | Upcoming/overdue bill banners | `src/components/bills/bill-reminder-provider.tsx` |
| `InstallBannerProvider` | PWA install prompt + height | `src/components/pwa/install-banner-context.tsx` |
| `ToastProvider` | Client notifications | `src/components/ui/toast.tsx` |

---

## Database & Prisma Review

### Schema Changes

- [ ] New migration file created via `pnpm db:migrate` (not manual SQL)
- [ ] Migration is reversible or has a documented rollback plan
- [ ] New columns have sensible defaults (avoid breaking existing rows)
- [ ] Indexes added for columns used in `WHERE`, `ORDER BY`, or `JOIN` clauses
- [ ] Unique constraints prevent duplicate data where appropriate
- [ ] No breaking changes to existing column types without a data migration

### Query Patterns

- [ ] Queries use `select` or `include` to limit returned fields (avoid `SELECT *` equivalent)
- [ ] Pagination used for list endpoints (default 15 items)
- [ ] Date-range queries apply `timezoneOffset` for correct boundaries
- [ ] Shared queries in `src/lib/budget-queries.ts` are read-only and dependency-injected

### Current Schema Models

| Model | Key Fields | Notes |
|-------|-----------|-------|
| `User` | id, email, role, currency, timezoneOffset | Roles: ADMIN, FREE, PAID |
| `Category` | id, name, type, icon, color, isDefault | Unique on (name, type, userId) |
| `Transaction` | id, amount, type, date, categoryId | Indexed on (userId, date) |
| `ScheduledTransaction` | id, frequency, nextDueDate, isActive | Bills / recurring |
| `ScheduledTransactionLog` | scheduledTransactionId, status | PAID, SKIPPED, SNOOZED |
| `AppSettings` | role, receiptScanEnabled, limits | Per-role feature gates |
| `ScanLog` | userId, createdAt | Monthly scan rate limiting |
| `VerificationToken` | token, type, expiresAt | Email verify + password reset |

---

## Performance Review

- [ ] No N+1 queries — use `include` or batch queries where needed
- [ ] Large lists use pagination (cursor or offset-based)
- [ ] Images compressed client-side before upload (`compressImage()` in `src/lib/utils.ts`)
- [ ] No unnecessary re-renders: memoize expensive computations, avoid inline object/array creation in JSX props
- [ ] TanStack Query `staleTime` and `placeholderData` configured to avoid redundant fetches
- [ ] Database indexes cover the query patterns being added

---

## PWA & Service Worker Review

- [ ] API routes use `NetworkOnly` strategy (no caching of auth-sensitive data)
- [ ] Protected pages use `NetworkOnly` strategy (no caching of user data)
- [ ] Static assets use default cache-first strategy
- [ ] Service worker disabled in development (`NODE_ENV === "development"`)
- [ ] Offline fallback page (`/~offline`) handles gracefully
- [ ] New routes added to the correct caching strategy in `src/app/sw.ts`

---

## Accessibility Review

- [ ] Interactive elements are keyboard-navigable (Tab, Enter, Escape)
- [ ] Form inputs have associated labels
- [ ] Color is not the only indicator of state (use icons/text alongside)
- [ ] Modals trap focus and close on Escape
- [ ] Images and icons have appropriate `alt` text or `aria-label`
- [ ] Sufficient color contrast (especially with the warm cream backgrounds)

---

## Code Style & Conventions

### Naming

| Element | Convention | Example |
|---------|-----------|---------|
| Files | `kebab-case` | `transaction-form.tsx` |
| Components | `PascalCase` | `TransactionForm` |
| Variables / Functions | `camelCase` | `formatCurrency` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_UPLOAD_SIZE` |
| DB columns | `snake_case` | `timezone_offset` |

### TypeScript

- [ ] `const` by default, `let` when needed, never `var`
- [ ] `unknown` over `any` — justify if `any` is truly needed
- [ ] `function` keyword for components, arrow functions for utilities
- [ ] New Zod schemas added to `src/lib/validations.ts` (not inline)

### Git

- [ ] Conventional commits: `feat(scope):`, `fix(scope):`, `refactor(scope):`, etc.
- [ ] Branch named `feature/*`, `bugfix/*`, or `hotfix/*`
- [ ] No direct commits to `main`

---

## Common Pitfalls

| Pitfall | What to Watch For |
|---------|-------------------|
| **Missing auth check** | New API route without `getAuthUserId()` call |
| **Stale query cache** | Mutation that doesn't invalidate affected query keys |
| **Timezone bugs** | Date queries without `timezoneOffset` — amounts show on wrong day |
| **Mobile overflow** | Content wider than viewport, horizontal scroll on mobile |
| **PWA cache poisoning** | User-specific data cached by service worker (should be `NetworkOnly`) |
| **Unhandled empty state** | List renders with no items and shows nothing (should show `EmptyState`) |
| **Missing loading state** | Data fetch with no skeleton/spinner — UI jumps on load |
| **Role gate bypass** | Feature restricted in UI but not enforced in API route |
| **Receipt scan limits** | Scan endpoint called without checking `ScanLog` monthly count |
| **Category deletion** | Deleting a category that still has linked transactions |

---

## File Reference

| What | Where |
|------|-------|
| Database schema | `prisma/schema.prisma` |
| Auth config | `src/lib/auth.ts` |
| Middleware | `src/middleware.ts` |
| Zod validations | `src/lib/validations.ts` |
| API routes | `src/app/api/` |
| Query hooks | `src/hooks/use-*.ts` |
| UI components | `src/components/ui/` |
| Context providers | `src/components/*-provider.tsx` |
| Utilities | `src/lib/utils.ts` |
| Service worker | `src/app/sw.ts` |
| PWA manifest | `src/app/manifest.ts` |
| Type definitions | `src/types/index.ts` |
| MCP server | `mcp-server/src/index.ts` |
