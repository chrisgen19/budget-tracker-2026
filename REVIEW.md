# REVIEW.md

## Always flag

### Security (blocking)
- Every API route MUST call `getAuthUserId()`, `getAuthUser()`, or `requireAdmin()` as the first operation — no exceptions
- Admin routes MUST use `requireAdmin()`, not UI-only role checks
- All mutations MUST verify ownership (`userId` match) on transactions, categories, and bills
- All user input MUST be validated with Zod schemas from `src/lib/validations.ts` — no inline validation
- Never use `$queryRaw` with string interpolation — Prisma parameterized queries only
- Passwords must never appear in logs, API responses, or error messages
- No secrets, API keys, or `.env` values in the diff
- File uploads must enforce MIME type (`image/*`) and 4MB size limit
- Receipt scan endpoints must check `ScanLog` monthly limits and respect role caps (FREE < PAID < ADMIN)

### Data integrity (blocking)
- Date-range queries MUST accept and apply `timezoneOffset` — without it, transactions appear on the wrong day for non-UTC users
- Delete operations must check for dependent records (e.g., can't delete a category that has transactions)
- Batch operations must use Prisma transactions when atomicity matters
- Foreign key references (e.g., `categoryId`) must be validated as belonging to the current user

### State management (blocking)
- All server data must use TanStack Query — no `useEffect` + `fetch` patterns
- Mutations must invalidate the correct query keys after success (check `src/hooks/use-*.ts` for existing key conventions)
- Never cache user-specific data in the service worker — API routes and protected pages must use `NetworkOnly` strategy in `src/app/sw.ts`

## Always check

### API routes
- Auth check → Zod validation → database call — in that order, always
- Error responses use `{ error: string }` shape with correct HTTP status (400/401/403/404/500)
- Handler body wrapped in try/catch with a generic 500 fallback

### Components & UI
- New/changed UI must handle all three states: loading, error, and empty
- Components should stay under ~150 lines, functions under ~50 — extract hooks or sub-components if larger
- Use Tailwind utility classes — no inline styles, no `@apply` unless truly necessary
- Mobile layout must work at 375px+; touch targets must be at least 44x44px
- MobileFab must account for install banner height via `InstallBannerContext`
- Modals must use the existing `Modal` component (has `visualViewport` keyboard handling for iOS Safari)

### Database
- New columns need sensible defaults to avoid breaking existing rows
- Add indexes for columns used in WHERE/ORDER BY clauses
- Migrations created via `pnpm db:migrate`, not manual SQL
- Shared read-only queries belong in `src/lib/budget-queries.ts` (dependency-injected for MCP reuse)

### TypeScript
- `const` by default, `let` when needed, never `var`
- `unknown` over `any` — flag any use of `any` without justification
- `function` keyword for React components, arrow functions for utilities
- No `console.log` in committed code

## Skip

- Changes only to `CHANGELOG.md`, `README.md`, or `AGENTS.md`
- Lock file updates (`pnpm-lock.yaml`) when accompanied by a valid dependency change
- Generated files: `prisma/migrations/*/migration.sql` (review the schema change in `schema.prisma` instead)
- Files in `mcp-server/` unless the PR specifically targets MCP functionality
- Formatting-only diffs with no logic changes

## Project-specific pitfalls

- **Timezone bugs**: Most common source of subtle issues — any query filtering by date/month without `timezoneOffset` will produce wrong results
- **Stale query cache**: Adding a new mutation without invalidating related queries causes the UI to show stale data
- **Role gate bypass**: Feature gated in the UI but the API route doesn't enforce the same restriction
- **PWA cache poisoning**: Adding a new protected route without adding it to the `NetworkOnly` list in `src/app/sw.ts`
- **Missing ownership check**: API route that reads/writes data without verifying `userId` — allows users to access other users' data
